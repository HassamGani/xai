import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const bodySchema = z.object({
  question: z.string().min(8)
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
    const { question } = bodySchema.parse(json);

    // Helper to call Grok with optional search; fallback to no-search if the first attempt fails
    async function callGrok(useSearch: boolean) {
      const res = await fetch(GROK_API_URL, {
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
                "You help create experiment markets for backtesting resolved questions. Use web search to infer the resolved outcome and resolution date if possible. Return strict JSON only."
            },
            {
              role: "user",
              content: `Question: "${question}"
Return JSON ONLY:
{
  "normalized_question": string,
  "outcomes": [{ "label": string }],
  "resolved_outcome_label": string | null,
  "resolved_at": string | null
}`
            }
          ],
          temperature: 0.2,
          max_tokens: 500,
          search: useSearch || undefined
        })
      });
      return res;
    }

    let grokRes = await callGrok(true);
    if (!grokRes.ok) {
      // Retry without search if the model rejects the search argument
      grokRes = await callGrok(false);
    }

    if (!grokRes.ok) {
      const errTxt = await grokRes.text();
      return NextResponse.json({ error: "Grok failed", details: errTxt }, { status: 502 });
    }

    const grokJson = await grokRes.json();
    const content = grokJson.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No Grok content" }, { status: 502 });
    }

    let parsed: {
      normalized_question: string;
      outcomes: Array<{ label: string }>;
      resolved_outcome_label?: string | null;
      resolved_at?: string | null;
    };
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
        resolution_outcome: parsed.resolved_outcome_label || null,
        resolved_at: parsed.resolved_at ? new Date(parsed.resolved_at).toISOString() : null
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

