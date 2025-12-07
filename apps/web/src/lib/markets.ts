import { supabaseServer } from "./supabase/server";

export type MarketRow = {
  id: string;
  question: string;
  normalized_question: string | null;
  status: string;
  created_at: string;
  total_posts_processed: number | null;
};

export type OutcomeRow = {
  id: string;
  market_id: string;
  outcome_id: string;
  label: string;
  current_probability: number | null;
  cumulative_support: number | null;
  cumulative_oppose: number | null;
  post_count: number | null;
  prior_probability: number | null;
};

export type MarketStateRow = {
  market_id: string;
  probabilities: Record<string, number>;
  updated_at: string;
  post_counts: number | null;
};

export type ProbabilitySnapshotRow = {
  id: string;
  market_id: string;
  timestamp: string;
  probabilities: Record<string, number>;
};

export type ScoredPostRow = {
  id: string;
  raw_post_id: string;
  market_id: string;
  outcome_id: string;
  scores: Record<string, number>;
  scored_at: string;
  display_labels: {
    summary?: string;
    reason?: string;
    credibility_label?: string;
    stance_label?: string;
  } | null;
};

export type RawPostRow = {
  id: string;
  market_id: string;
  x_post_id: string;
  text: string;
  author_id: string | null;
  author_followers: number | null;
  author_verified: boolean | null;
  metrics: Record<string, number> | null;
  post_created_at: string | null;
  features: Record<string, number | boolean> | null;
};

export async function listMarkets() {
  const { data, error } = await supabaseServer
    .from("markets")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MarketRow[];
}

export async function getMarket(marketId: string) {
  const [marketRes, outcomesRes, stateRes, snapshotsRes] = await Promise.all([
    supabaseServer.from("markets").select("*").eq("id", marketId).single(),
    supabaseServer
      .from("outcomes")
      .select("*")
      .eq("market_id", marketId)
      .order("label", { ascending: true }),
    supabaseServer.from("market_state").select("*").eq("market_id", marketId).single(),
    supabaseServer
      .from("probability_snapshots")
      .select("*")
      .eq("market_id", marketId)
      .order("timestamp", { ascending: true })
      .limit(400)
  ]);

  if (marketRes.error) throw marketRes.error;
  if (outcomesRes.error) throw outcomesRes.error;
  if (stateRes.error && stateRes.status !== 406) throw stateRes.error;
  if (snapshotsRes.error) throw snapshotsRes.error;

  return {
    market: marketRes.data as MarketRow,
    outcomes: (outcomesRes.data ?? []) as OutcomeRow[],
    state: stateRes.data as MarketStateRow | null,
    snapshots: (snapshotsRes.data ?? []) as ProbabilitySnapshotRow[]
  };
}

export async function getMarketPosts(marketId: string, limit = 20) {
  const scoredRes = await supabaseServer
    .from("scored_posts")
    .select("*")
    .eq("market_id", marketId)
    .order("scored_at", { ascending: false })
    .limit(limit);

  if (scoredRes.error) throw scoredRes.error;

  const rawIds = Array.from(new Set((scoredRes.data ?? []).map((p) => p.raw_post_id)));
  const rawRes = await supabaseServer.from("raw_posts").select("*").in("id", rawIds);
  if (rawRes.error) throw rawRes.error;

  const rawMap = new Map<string, RawPostRow>();
  (rawRes.data ?? []).forEach((r) => rawMap.set(r.id, r as RawPostRow));

  return (scoredRes.data ?? []).map((row) => ({
    scored: row as ScoredPostRow,
    raw: rawMap.get((row as ScoredPostRow).raw_post_id) ?? null
  }));
}

