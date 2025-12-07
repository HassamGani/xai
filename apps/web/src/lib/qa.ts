import type { SupabaseClient } from "@supabase/supabase-js";
import { isSimpleRetweet, type MarketRow, type OutcomeRow, type RawPostRow } from "./markets";

export type MarketSummary = MarketRow & {
  outcomes: OutcomeRow[];
  probabilities: Record<string, number>;
};

export type MarketProbabilitySnapshot = {
  market_id: string;
  probabilities: Record<string, number>;
  timestamp: string;
};

export type MarketMover = {
  market_id: string;
  question?: string;
  normalized_question?: string | null;
  delta: number;
  from: number;
  to: number;
  top_outcome?: { outcome_id: string; label: string; probability: number };
};

export type DriverEvidence = {
  market_id: string;
  outcome_id: string;
  scored_at: string;
  summary?: string;
  reason?: string;
  text: string | null;
  author_username?: string | null;
};

/**
 * Compute the top movers given current and baseline snapshots.
 * Pure helper so it can be unit tested without Supabase.
 */
export function rankTopMovers(
  current: MarketProbabilitySnapshot[],
  baseline: MarketProbabilitySnapshot[],
  limit = 5
): MarketMover[] {
  const baselineMap = new Map<string, MarketProbabilitySnapshot>();
  baseline.forEach((snap) => {
    if (!baselineMap.has(snap.market_id)) {
      baselineMap.set(snap.market_id, snap);
    }
  });

  const movers = current.map((curr) => {
    const base = baselineMap.get(curr.market_id);
    const from = base ? maxProbability(base.probabilities) : maxProbability(curr.probabilities);
    const to = maxProbability(curr.probabilities);
    return {
      market_id: curr.market_id,
      delta: to - from,
      from,
      to
    };
  });

  return movers
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

function maxProbability(probabilities: Record<string, number> | null | undefined) {
  if (!probabilities) return 0;
  return Object.values(probabilities).reduce((max, val) => {
    const v = typeof val === "number" ? val : 0;
    return v > max ? v : max;
  }, 0);
}

/**
 * Fetch market summaries (markets + outcomes + live probabilities).
 */
export async function fetchMarketSummaries(
  supabase: SupabaseClient,
  opts: { marketIds?: string[]; limit?: number; statusNot?: string } = {}
): Promise<MarketSummary[]> {
  const { marketIds, limit = 100, statusNot = "resolved" } = opts;
  let marketQuery = supabase
    .from("markets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (marketIds && marketIds.length > 0) {
    marketQuery = marketQuery.in("id", marketIds);
  }
  if (statusNot) {
    marketQuery = marketQuery.neq("status", statusNot);
  }

  const { data: markets, error: marketError } = await marketQuery;
  if (marketError) throw marketError;

  const ids = (markets ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  const [{ data: outcomes, error: outcomeError }, { data: states, error: stateError }] = await Promise.all([
    supabase.from("outcomes").select("*").in("market_id", ids),
    supabase.from("market_state").select("*").in("market_id", ids)
  ]);

  if (outcomeError) throw outcomeError;
  if (stateError) throw stateError;

  const outcomesMap = new Map<string, OutcomeRow[]>();
  (outcomes ?? []).forEach((o) => {
    const list = outcomesMap.get(o.market_id) ?? [];
    list.push(o as OutcomeRow);
    outcomesMap.set(o.market_id, list);
  });

  const statesMap = new Map<string, Record<string, number>>();
  (states ?? []).forEach((s) => {
    statesMap.set(s.market_id, (s as { probabilities: Record<string, number> }).probabilities ?? {});
  });

  return (markets ?? []).map((m) => {
    const marketOutcomes = outcomesMap.get(m.id) ?? [];
    const probs = statesMap.get(m.id) ?? {};
    return {
      ...(m as MarketRow),
      outcomes: marketOutcomes,
      probabilities: probs
    };
  });
}

/**
 * Convert market summaries into probability snapshots so we can reuse the
 * same ranking helper.
 */
export function toSnapshots(summaries: MarketSummary[]): MarketProbabilitySnapshot[] {
  return summaries.map((m) => ({
    market_id: m.id,
    probabilities: m.probabilities,
    timestamp: m.created_at
  }));
}

export async function fetchBaselineSnapshots(
  supabase: SupabaseClient,
  windowDays: number,
  marketIds: string[]
): Promise<MarketProbabilitySnapshot[]> {
  if (marketIds.length === 0) return [];
  const startIso = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("probability_snapshots")
    .select("market_id, probabilities, timestamp")
    .gte("timestamp", startIso)
    .in("market_id", marketIds)
    .order("timestamp", { ascending: true })
    .limit(1000);

  if (error) throw error;

  // We only need the earliest snapshot within the window per market
  const seen = new Set<string>();
  const baseline: MarketProbabilitySnapshot[] = [];
  (data ?? []).forEach((row) => {
    if (seen.has(row.market_id)) return;
    seen.add(row.market_id);
    baseline.push({
      market_id: row.market_id as string,
      probabilities: (row as { probabilities: Record<string, number> }).probabilities ?? {},
      timestamp: row.timestamp as string
    });
  });

  return baseline;
}

export async function getTopMovers(
  supabase: SupabaseClient,
  opts: { windowDays?: number; limit?: number }
): Promise<MarketMover[]> {
  const windowDays = opts.windowDays ?? 7;
  const limit = opts.limit ?? 5;
  const summaries = await fetchMarketSummaries(supabase, { limit: 120, statusNot: "archived" });
  const ids = summaries.map((m) => m.id);
  const baseline = await fetchBaselineSnapshots(supabase, windowDays, ids);
  const movers = rankTopMovers(toSnapshots(summaries), baseline, limit);

  const summaryMap = new Map(summaries.map((m) => [m.id, m]));

  return movers.map((m) => {
    const summary = summaryMap.get(m.market_id);
    const topOutcome = summary ? pickTopOutcome(summary) : undefined;
    return {
      market_id: m.market_id,
      question: summary?.question ?? "",
      normalized_question: summary?.normalized_question ?? null,
      delta: m.delta,
      from: m.from,
      to: m.to,
      top_outcome: topOutcome
    };
  });
}

function pickTopOutcome(summary: MarketSummary | undefined) {
  if (!summary) return undefined;
  let best: { outcome_id: string; label: string; probability: number } | undefined;
  for (const o of summary.outcomes) {
    const prob = summary.probabilities?.[o.outcome_id] ?? summary.probabilities?.[o.label] ?? o.current_probability ?? 0;
    if (!best || prob > best.probability) {
      best = { outcome_id: o.outcome_id, label: o.label, probability: prob ?? 0 };
    }
  }
  return best;
}

export async function searchMarkets(
  supabase: SupabaseClient,
  topics: string[],
  limit = 10
): Promise<MarketSummary[]> {
  if (topics.length === 0) return [];
  const ors = topics
    .map((t) => t.trim())
    .filter(Boolean)
    .flatMap((t) => [`question.ilike.%${t}%`, `normalized_question.ilike.%${t}%`]);
  if (ors.length === 0) return [];

  const { data, error } = await supabase
    .from("markets")
    .select("*")
    .or(ors.join(","))
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const ids = (data ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  const [{ data: outcomes }, { data: states }] = await Promise.all([
    supabase.from("outcomes").select("*").in("market_id", ids),
    supabase.from("market_state").select("*").in("market_id", ids)
  ]);

  const outcomesMap = new Map<string, OutcomeRow[]>();
  (outcomes ?? []).forEach((o) => {
    const list = outcomesMap.get(o.market_id) ?? [];
    list.push(o as OutcomeRow);
    outcomesMap.set(o.market_id, list);
  });

  const statesMap = new Map<string, Record<string, number>>();
  (states ?? []).forEach((s) => {
    statesMap.set(s.market_id, (s as { probabilities: Record<string, number> }).probabilities ?? {});
  });

  return (data ?? []).map((m) => ({
    ...(m as MarketRow),
    outcomes: outcomesMap.get(m.id) ?? [],
    probabilities: statesMap.get(m.id) ?? {}
  }));
}

export async function fetchMarketDrivers(
  supabase: SupabaseClient,
  marketIds: string[],
  perMarket = 3
): Promise<DriverEvidence[]> {
  if (marketIds.length === 0) return [];

  const { data: scored, error } = await supabase
    .from("scored_posts")
    .select("id, market_id, raw_post_id, outcome_id, display_labels, scored_at")
    .in("market_id", marketIds)
    .order("scored_at", { ascending: false })
    .limit(perMarket * marketIds.length * 4);

  if (error) throw error;

  const rawIds = Array.from(new Set((scored ?? []).map((s) => s.raw_post_id as string).filter(Boolean)));
  if (rawIds.length === 0) return [];

  const { data: rawPosts, error: rawError } = await supabase.from("raw_posts").select("*").in("id", rawIds);
  if (rawError) throw rawError;

  const rawMap = new Map<string, RawPostRow>();
  (rawPosts ?? []).forEach((r) => rawMap.set(r.id, r as RawPostRow));

  const grouped = new Map<string, DriverEvidence[]>();

  (scored ?? []).forEach((row) => {
    const raw = rawMap.get(row.raw_post_id as string);
    if (!raw) return;
    if (isSimpleRetweet(raw)) return;

    const existing = grouped.get(row.market_id as string) ?? [];
    if (existing.length >= perMarket) return;

    const labels = (row.display_labels as { summary?: string; reason?: string } | null) ?? {};
    grouped.set(row.market_id as string, [
      ...existing,
      {
        market_id: row.market_id as string,
        outcome_id: row.outcome_id as string,
        scored_at: row.scored_at as string,
        summary: labels.summary,
        reason: labels.reason,
        text: raw.text ?? null,
        author_username: (raw as RawPostRow).author_username
      }
    ]);
  });

  return Array.from(grouped.values()).flat();
}
