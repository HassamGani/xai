import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MarketQaIntentSchema, marketQaIntentPrompt, type MarketQaIntent } from "@shared/llm/marketQa";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import {
  fetchBaselineSnapshots,
  fetchMarketDrivers,
  getTopMovers,
  rankTopMovers,
  searchMarkets,
  toSnapshots
} from "@/lib/qa";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const RequestSchema = z.object({
  query: z.string().min(3).max(400)
});

type QaContext = {
  markets: Array<{
    id: string;
    question: string;
    normalized_question: string | null;
    top_outcome?: { outcome_id: string; label: string; probability: number };
    delta?: number;
  }>;
  drivers: Array<{
    market_id: string;
    summary?: string;
    reason?: string;
    text: string | null;
    author_username?: string | null;
  }>;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("bad_request", "Query is required", 400, parsed.error.flatten());
  }

  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    return jsonError("missing_grok_key", "Grok API key not configured", 503);
  }

  const supabase = getSupabaseAdmin() || getSupabaseServer();
  if (!supabase) {
    return jsonError("db_not_configured", "Database client not available", 503);
  }

  const { query } = parsed.data;

  const intent = await classifyIntent(query, apiKey);
  const windowDays = intent.time_window_days ?? 7;
  const limit = intent.limit ?? 5;
  const topics = intent.topics && intent.topics.length > 0 ? intent.topics : [query];

  const context: QaContext = { markets: [], drivers: [] };

  try {
    if (intent.intent === "top_movers") {
      const movers = await getTopMovers(supabase, { windowDays, limit });
      context.markets = movers.map((m) => ({
        id: m.market_id,
        question: m.question,
        normalized_question: m.normalized_question,
        delta: m.delta,
        top_outcome: m.top_outcome
      }));
    } else if (intent.intent === "drivers") {
      const matches = await searchMarkets(supabase, topics, limit);
      const driverEvidence = await fetchMarketDrivers(
        supabase,
        matches.map((m) => m.id),
        3
      );
      context.markets = matches.map((m) => ({
        id: m.id,
        question: m.question,
        normalized_question: m.normalized_question,
        top_outcome: pickTopOutcome(m)
      }));
      context.drivers = driverEvidence;
    } else if (intent.intent === "find_correlations") {
      const matches = await searchMarkets(supabase, topics, Math.max(limit, 6));
      const baseline = await fetchBaselineSnapshots(
        supabase,
        windowDays,
        matches.map((m) => m.id)
      );
      const movers = rankTopMovers(toSnapshots(matches), baseline, limit);
      const matchMap = new Map(matches.map((m) => [m.id, m]));
      context.markets = movers.map((m) => {
        const summary = matchMap.get(m.market_id);
        return {
          id: m.market_id,
          question: summary?.question ?? "",
          normalized_question: summary?.normalized_question ?? null,
          delta: m.delta,
          top_outcome: summary ? pickTopOutcome(summary) : undefined
        };
      });
    } else {
      const matches = await searchMarkets(supabase, topics, limit);
      context.markets = matches.map((m) => ({
        id: m.id,
        question: m.question,
        normalized_question: m.normalized_question,
        top_outcome: pickTopOutcome(m)
      }));
    }
  } catch (error) {
    console.error("QA data fetch error", error);
    return jsonError("query_failed", "Failed to fetch market data", 500);
  }

  const answer = await craftAnswer(apiKey, query, intent, context);

  return NextResponse.json({
    intent,
    answer,
    markets: context.markets,
    drivers: context.drivers
  });
}

function jsonError(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function classifyIntent(query: string, apiKey: string): Promise<MarketQaIntent> {
  const today = new Date().toISOString().split("T")[0];
  const fallbackIntent: MarketQaIntent = {
    intent: "search",
    topics: [query],
    time_window_days: 7,
    limit: 5,
    needs_posts: false
  };

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-3-latest",
        messages: [
          { role: "system", content: marketQaIntentPrompt(today) },
          { role: "user", content: query }
        ],
        temperature: 0,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      console.warn("Grok intent classify failed", response.status);
      return fallbackIntent;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return fallbackIntent;
    }

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());
    return MarketQaIntentSchema.parse(parsed);
  } catch (error) {
    console.error("Intent parse error", error);
    return fallbackIntent;
  }
}

async function craftAnswer(
  apiKey: string,
  query: string,
  intent: MarketQaIntent,
  context: QaContext
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const contextPayload = JSON.stringify(context, null, 2);
  const systemPrompt = `You summarize prediction market data into concise answers.
Rules:
- Only use the provided context JSON (no outside knowledge).
- Keep answers under 120 words.
- Do NOT use asterisks or bold.
- Format as markdown with a short intro and a bullet list.
- For each market bullet, include only the market title and movement on one line. Do NOT include links or market IDs.
- If no markets are available, say so briefly.
- Be specific about probability moves when present.`;

  const userPrompt = `User query: "${query}"
Intent: ${intent.intent}
Topics: ${(intent.topics ?? []).join(", ")}
Today's date: ${today}

Context JSON:
${contextPayload}

Write a short answer that cites the most relevant markets and links.`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-3-latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 220
      })
    });

    if (!response.ok) {
      console.warn("Grok answer failed", response.status);
      return fallbackAnswer(context);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return fallbackAnswer(context);
    return String(content).trim();
  } catch (error) {
    console.error("Answer craft error", error);
    return fallbackAnswer(context);
  }
}

function fallbackAnswer(context: QaContext): string {
  if (!context.markets.length) {
    return "No relevant markets found yet.";
  }
  const first = context.markets[0];
  return `Top match: "${first.question}" (/market/${first.id})`;
}

function pickTopOutcome(summary: {
  probabilities: Record<string, number>;
  outcomes: Array<{ outcome_id: string; label: string; current_probability: number | null }>;
}) {
  let best: { outcome_id: string; label: string; probability: number } | undefined;
  for (const o of summary.outcomes) {
    const prob = summary.probabilities?.[o.outcome_id] ?? summary.probabilities?.[o.label] ?? o.current_probability ?? 0;
    if (!best || prob > best.probability) {
      best = { outcome_id: o.outcome_id, label: o.label, probability: prob ?? 0 };
    }
  }
  return best;
}
