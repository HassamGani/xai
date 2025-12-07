import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GROK_API_KEY not configured" }, { status: 503 });
    }
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const { id } = paramsSchema.parse(params);

    const { data: exp, error } = await supabase
      .from("experiment_markets")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !exp) {
      return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    }

    // Insert a run record
    const { data: run } = await supabase
      .from("experiment_runs")
      .insert({ experiment_id: id, status: "running" })
      .select("id")
      .single();

    // Ask Grok to synthesize a probability timeline (backtest-lite)
    const grokRes = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-3-latest",
        messages: [
          {
            role: "system",
            content:
              "You generate synthetic probability timelines for backtesting. Return JSON with chronological points."
          },
          {
            role: "user",
            content: `Question: "${exp.question}"
Outcomes: ${(exp.outcomes || []).map((o: any) => o.label).join(", ")}
Known resolved outcome (optional): ${exp.resolution_outcome || "unknown"}
Resolved at (optional): ${exp.resolved_at || "unknown"}

Return JSON: { "points": [ { "timestamp": "ISO string", "probabilities": { "<outcome>": number } } ] }
- timestamps must be ascending
- probabilities must sum to 1.0 each point
- include at least 8 points, start well before resolution date if provided`
          }
        ],
        temperature: 0.2,
        max_tokens: 800
      })
    });

    if (!grokRes.ok) {
      const errTxt = await grokRes.text();
      await supabase.from("experiment_runs").update({ status: "failed", error: errTxt }).eq("id", run?.id);
      return NextResponse.json({ error: "Grok failed", details: errTxt }, { status: 502 });
    }

    const grokJson = await grokRes.json();
    const content = grokJson.choices?.[0]?.message?.content;
    if (!content) {
      await supabase.from("experiment_runs").update({ status: "failed", error: "No Grok content" }).eq("id", run?.id);
      return NextResponse.json({ error: "No Grok content" }, { status: 502 });
    }

    let parsed: { points: Array<{ timestamp: string; probabilities: Record<string, number> }> };
    try {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(match[1]);
    } catch (e) {
      await supabase.from("experiment_runs").update({ status: "failed", error: "Parse failure" }).eq("id", run?.id);
      return NextResponse.json({ error: "Failed to parse Grok JSON" }, { status: 500 });
    }

    const points = (parsed.points || []).filter(
      (p) => p.timestamp && p.probabilities && Object.keys(p.probabilities).length > 0
    );

    if (points.length === 0) {
      await supabase.from("experiment_runs").update({ status: "failed", error: "No points returned" }).eq("id", run?.id);
      return NextResponse.json({ error: "No timeline returned" }, { status: 500 });
    }

    // Insert snapshots
    const snapshotRows = points.map((p) => ({
      experiment_id: id,
      timestamp: new Date(p.timestamp).toISOString(),
      probabilities: p.probabilities
    }));

    const { error: snapErr } = await supabase.from("experiment_snapshots").insert(snapshotRows);
    if (snapErr) {
      await supabase.from("experiment_runs").update({ status: "failed", error: snapErr.message }).eq("id", run?.id);
      return NextResponse.json({ error: "Failed to store snapshots" }, { status: 500 });
    }

    // Finalize run
    await supabase
      .from("experiment_runs")
      .update({ status: "finished", finished_at: new Date().toISOString(), post_count: 0 })
      .eq("id", run?.id);

    return NextResponse.json({
      run_id: run?.id,
      snapshots: snapshotRows
    });
  } catch (error) {
    console.error("Experiment run error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

