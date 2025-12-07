import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const bodySchema = z.object({
  question: z.string().min(8),
  knownOutcome: z.string().optional(),
  resolvedAt: z.string().datetime().optional()
});

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GROK_API_KEY not configured" }, { status: 503 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const json = await request.json();
    const { question, knownOutcome, resolvedAt } = bodySchema.parse(json);

    // Ask Grok to normalize the question and propose outcomes and keywords
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
              "You help create experiment markets for backtesting. Given a question, propose concise normalized text and 3-6 mutually exclusive outcomes. Return strict JSON."
          },
          {
            role: "user",
            content: `Question: "${question}"
Return JSON: { "normalized_question": string, "outcomes": [{ "label": string }] }`
          }
        ],
        temperature: 0.3,
        max_tokens: 400
      })
    });

    if (!grokRes.ok) {
      const errTxt = await grokRes.text();
      return NextResponse.json({ error: "Grok failed", details: errTxt }, { status: 502 });
    }

    const grokJson = await grokRes.json();
    const content = grokJson.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No Grok content" }, { status: 502 });
    }

    let parsed: { normalized_question: string; outcomes: Array<{ label: string }> };
    try {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(match[1]);
    } catch (e) {
      return NextResponse.json({ error: "Failed to parse Grok JSON" }, { status: 500 });
    }

    const outcomes = (parsed.outcomes || []).map((o, idx) => ({
      id: `o-${idx + 1}`,
      label: o.label
    }));

    const { data, error } = await supabase
      .from("experiment_markets")
      .insert({
        question,
        normalized_question: parsed.normalized_question || question,
        outcomes,
        resolution_outcome: knownOutcome || null,
        resolved_at: resolvedAt ? new Date(resolvedAt).toISOString() : null
      })
      .select("id, question, normalized_question, outcomes, resolution_outcome, resolved_at")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create experiment", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ experiment: data });
  } catch (error) {
    console.error("Experiment create error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

