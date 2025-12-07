import { getSupabaseServer, getSupabaseAdmin } from "./supabase/server";

export type MarketRow = {
  id: string;
  question: string;
  normalized_question: string | null;
  status: string;
  created_at: string;
  total_posts_processed: number | null;
  posts_count?: number | null;
  estimated_resolution_date: string | null;
  resolution_criteria: string | null;
  resolved_at: string | null;
  resolved_outcome_id: string | null;
  resolution_summary: string | null;
  resolution_source: string | null;
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
  author_username?: string | null;
  author_followers: number | null;
  author_verified: boolean | null;
  metrics: Record<string, number> | null;
  post_created_at: string | null;
  features: Record<string, number | boolean> | null;
  is_retweet: boolean | null;
  is_quote_retweet: boolean | null;
  referenced_post_id: string | null;
};

export type MarketWithProbabilities = MarketRow & {
  outcomes: Array<{ id: string; label: string; probability: number }>;
};

export async function listMarkets(): Promise<MarketWithProbabilities[]> {
  // Prefer admin client to avoid any RLS issues when listing markets
  const supabase = getSupabaseAdmin() || getSupabaseServer();
  if (!supabase) {
    console.warn("listMarkets: No Supabase client available");
    return [];
  }
  
  const { data, error } = await supabase
    .from("markets")
    .select("*")
    .order("created_at", { ascending: false });
  
  if (error) {
    console.error("listMarkets error:", error);
    throw error;
  }
  
  console.log(`listMarkets: Found ${data?.length ?? 0} markets`);
  
  const markets = (data ?? []) as MarketRow[];

  // Fetch outcomes and market_state for all markets in parallel
  const marketIds = markets.map((m) => m.id);
  
  const [outcomesRes, statesRes] = await Promise.all([
    supabase.from("outcomes").select("*").in("market_id", marketIds),
    supabase.from("market_state").select("*").in("market_id", marketIds)
  ]);

  const outcomesMap = new Map<string, OutcomeRow[]>();
  (outcomesRes.data ?? []).forEach((o) => {
    const list = outcomesMap.get(o.market_id) ?? [];
    list.push(o as OutcomeRow);
    outcomesMap.set(o.market_id, list);
  });

  const statesMap = new Map<string, MarketStateRow>();
  (statesRes.data ?? []).forEach((s) => {
    statesMap.set(s.market_id, s as MarketStateRow);
  });

  // Attach live post counts and probabilities
  const results: MarketWithProbabilities[] = await Promise.all(
    markets.map(async (m) => {
      const { count } = await supabase
        .from("raw_posts")
        .select("*", { count: "exact", head: true })
        .eq("market_id", m.id);
      m.posts_count = count ?? m.total_posts_processed ?? 0;

      const marketOutcomes = outcomesMap.get(m.id) ?? [];
      const state = statesMap.get(m.id);
      
      // Build outcomes with probabilities from market_state or fallback to outcome's current_probability
      const outcomes = marketOutcomes.map((o) => {
        let prob = 0;
        if (state?.probabilities) {
          // Try to find probability in state.probabilities (keyed by outcome_id or label)
          prob = state.probabilities[o.outcome_id] ?? state.probabilities[o.label] ?? 0;
        }
        if (prob === 0 && o.current_probability != null) {
          prob = o.current_probability;
        }
        return {
          id: o.id,
          label: o.label,
          probability: prob
        };
      }).sort((a, b) => b.probability - a.probability);

      return {
        ...m,
        outcomes
      };
    })
  );

  return results;
}

export async function getMarket(marketId: string) {
  const supabase = getSupabaseAdmin() || getSupabaseServer();
  if (!supabase) {
    return {
      market: null,
      outcomes: [],
      state: null,
      snapshots: []
    };
  }
  const [marketRes, outcomesRes, stateRes, snapshotsRes] = await Promise.all([
    supabase.from("markets").select("*").eq("id", marketId).single(),
    supabase
      .from("outcomes")
      .select("*")
      .eq("market_id", marketId)
      .order("label", { ascending: true }),
    supabase.from("market_state").select("*").eq("market_id", marketId).single(),
    supabase
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

  // Accurate post count from raw_posts
  const { count: rawCount } = await supabase
    .from("raw_posts")
    .select("*", { count: "exact", head: true })
    .eq("market_id", marketId);

  return {
    market: {
      ...(marketRes.data as MarketRow),
      posts_count: rawCount ?? marketRes.data?.total_posts_processed ?? null,
      total_posts_processed: rawCount ?? marketRes.data?.total_posts_processed ?? null
    } as MarketRow,
    outcomes: (outcomesRes.data ?? []) as OutcomeRow[],
    state: stateRes.data as MarketStateRow | null,
    snapshots: (snapshotsRes.data ?? []) as ProbabilitySnapshotRow[]
  };
}

export async function getMarketPosts(marketId: string, limit = 20) {
  const supabase = getSupabaseAdmin() || getSupabaseServer();
  if (!supabase) return [];

  // Get scored posts
  const scoredRes = await supabase
    .from("scored_posts")
    .select("*")
    .eq("market_id", marketId)
    .order("scored_at", { ascending: false })
    .limit(limit * 3); // Fetch extra to account for filtered retweets and duplicates

  if (scoredRes.error) throw scoredRes.error;

  const rawIds = Array.from(new Set((scoredRes.data ?? []).map((p) => p.raw_post_id)));
  
  // Get all raw posts (we'll filter in code for more flexibility)
  const rawRes = await supabase
    .from("raw_posts")
    .select("*")
    .in("id", rawIds);

  if (rawRes.error) throw rawRes.error;

  const rawMap = new Map<string, RawPostRow>();
  (rawRes.data ?? []).forEach((r) => rawMap.set(r.id, r as RawPostRow));

  // Track seen x_post_ids to deduplicate
  const seenPostIds = new Set<string>();

  // Filter posts
  const results = (scoredRes.data ?? [])
    .map((row) => ({
      scored: row as ScoredPostRow,
      raw: rawMap.get((row as ScoredPostRow).raw_post_id) ?? null
    }))
    .filter((item) => {
      if (!item.raw) return false;
      
      // Deduplicate by x_post_id
      if (item.raw.x_post_id) {
        if (seenPostIds.has(item.raw.x_post_id)) return false;
        seenPostIds.add(item.raw.x_post_id);
      }
      
      // Check if it's a simple retweet via flag
      if (item.raw.is_retweet === true && item.raw.is_quote_retweet !== true) {
        return false;
      }
      
      // Fallback: check text pattern for "RT @" (for legacy data without flags)
      if (item.raw.text && item.raw.text.trim().startsWith("RT @")) {
        return false;
      }
      
      return true;
    })
    .slice(0, limit);

  return results;
}

/**
 * Check if a post is a simple retweet (should be excluded from display/scoring)
 * but its metrics should still count
 */
export function isSimpleRetweet(post: RawPostRow): boolean {
  // If explicitly marked as retweet but NOT a quote retweet, it's a simple RT
  if (post.is_retweet === true && post.is_quote_retweet !== true) {
    return true;
  }
  
  // Fallback: check text pattern for "RT @" at the start (legacy data)
  if (post.text && post.text.trim().startsWith("RT @")) {
    return true;
  }
  
  return false;
}

/**
 * Check if a post should be scored and displayed
 * (Original tweets + quote retweets, but not simple retweets)
 */
export function shouldScorePost(post: RawPostRow): boolean {
  return !isSimpleRetweet(post);
}
