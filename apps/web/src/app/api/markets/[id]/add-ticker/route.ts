import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type OutcomeRow = {
  id: string;
  market_id: string;
  outcome_id: string;
  label: string;
  current_probability: number | null;
};

const jsonResponse = (body: unknown, status = 200) =>
  NextResponse.json(body, { status });

function slugifyLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function isSimilarLabel(label: string, existing: string) {
  const a = label.toLowerCase().trim();
  const b = existing.toLowerCase().trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aWords = new Set(a.split(/\s+/).filter(Boolean));
  const bWords = new Set(b.split(/\s+/).filter(Boolean));
  if (!aWords.size || !bWords.size) return false;
  const overlap = [...aWords].filter((w) => bWords.has(w)).length;
  const jaccard = overlap / new Set([...aWords, ...bWords]).size;
  return jaccard >= 0.6;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;

  const devSecret = request.headers.get("x-dev-secret");
  const internalSecret = process.env.INTERNAL_DEV_SECRET;
  if (!internalSecret || devSecret !== internalSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return jsonResponse({ error: "Database not configured" }, 503);

  const body = await request.json();
  const label: string = body?.label?.trim();
  const ruleTemplate: string = body?.rule_template?.trim();
  const initialProb: number = Math.min(Math.max(body?.initial_probability ?? 0.05, 0.01), 0.2);

  if (!label || label.length < 2) return jsonResponse({ error: "Label required" }, 400);
  if (!ruleTemplate || ruleTemplate.length < 3)
    return jsonResponse({ error: "Rule template required" }, 400);

  // Fetch market and outcomes
  const [{ data: market }, { data: outcomes }] = await Promise.all([
    supabase.from("markets").select("*").eq("id", marketId).single(),
    supabase.from("outcomes").select("*").eq("market_id", marketId),
  ]);

  if (!market) return jsonResponse({ error: "Market not found" }, 404);

  const existingOutcomes = (outcomes ?? []) as OutcomeRow[];

  // Duplicate / similarity checks
  for (const o of existingOutcomes) {
    if (isSimilarLabel(label, o.label) || isSimilarLabel(label, o.outcome_id)) {
      return jsonResponse({ error: "Ticker already exists or is too similar" }, 400);
    }
  }

  const outcome_id = slugifyLabel(label) || `outcome_${existingOutcomes.length + 1}`;

  // Probabilities: start new with initialProb, renormalize others
  const currentState =
    (await supabase.from("market_state").select("*").eq("market_id", marketId).single()).data;
  const prevProbs: Record<string, number> =
    currentState?.probabilities ??
    Object.fromEntries(existingOutcomes.map((o) => [o.outcome_id, o.current_probability ?? 1 / (existingOutcomes.length || 1)]));

  const scaledProbs: Record<string, number> = {};
  const scale = 1 - initialProb;
  for (const [k, v] of Object.entries(prevProbs)) {
    scaledProbs[k] = v * scale;
  }
  scaledProbs[outcome_id] = initialProb;

  // Normalize just in case
  const total = Object.values(scaledProbs).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(scaledProbs)) {
    scaledProbs[k] = scaledProbs[k] / total;
  }

  // Normalize rule template (-is:retweet lang:en)
  const normalizedRule = `${ruleTemplate}${ruleTemplate.toLowerCase().includes("is:retweet") ? "" : " -is:retweet"}${ruleTemplate.toLowerCase().includes("lang:") ? "" : " lang:en"}`.trim();
  const newRuleTemplates = [...(market.x_rule_templates ?? []), normalizedRule];

  // Insert outcome
  const { error: insertErr } = await supabase.from("outcomes").insert({
    market_id: marketId,
    outcome_id,
    label,
    current_probability: scaledProbs[outcome_id],
    cumulative_support: 0,
    cumulative_oppose: 0,
    post_count: 0,
  });
  if (insertErr) return jsonResponse({ error: "Failed to add outcome" }, 500);

  // Update market state and snapshot
  await supabase.from("market_state").upsert({
    market_id: marketId,
    probabilities: scaledProbs,
    updated_at: new Date().toISOString(),
  });
  await supabase.from("probability_snapshots").insert({
    market_id: marketId,
    probabilities: scaledProbs,
  });

  // Update market rule templates
  await supabase.from("markets").update({ x_rule_templates: newRuleTemplates }).eq("id", marketId);

  // Add X rules live if bearer token exists
  const bearer = process.env.X_BEARER_TOKEN;
  if (bearer) {
    const tagPrefix = `market:${marketId}:`;
    // find next index
    const nextIdx = (market.x_rule_templates?.length ?? 0);
    const addBody = { add: [{ value: normalizedRule, tag: `${tagPrefix}${nextIdx}` }] };
    await fetch("https://api.twitter.com/2/tweets/search/stream/rules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(addBody),
    });
  }

  revalidatePath("/");
  revalidatePath(`/market/${marketId}`);

  return jsonResponse({
    success: true,
    outcome_id,
    label,
    probabilities: scaledProbs,
    rule_added: normalizedRule,
  });
}

