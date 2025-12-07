import { getSupabaseServer } from "./supabase/server";

export type MarketRow = {
  id: string;
  question: string;
  normalized_question: string | null;
  status: string;
  created_at: string;
  total_posts_processed: number | null;
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
  author_followers: number | null;
  author_verified: boolean | null;
  metrics: Record<string, number> | null;
  post_created_at: string | null;
  features: Record<string, number | boolean> | null;
  is_retweet: boolean | null;
  is_quote_retweet: boolean | null;
  referenced_post_id: string | null;
};

export async function listMarkets() {
  const supabase = getSupabaseServer();
  if (!supabase) return [];
  const { data, error } = await supabase.from("markets").select("*").order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MarketRow[];
}

export async function getMarket(marketId: string) {
  const supabase = getSupabaseServer();
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

  return {
    market: marketRes.data as MarketRow,
    outcomes: (outcomesRes.data ?? []) as OutcomeRow[],
    state: stateRes.data as MarketStateRow | null,
    snapshots: (snapshotsRes.data ?? []) as ProbabilitySnapshotRow[]
  };
}

export async function getMarketPosts(marketId: string, limit = 20) {
  const supabase = getSupabaseServer();
  if (!supabase) return [];

  // Get scored posts
  const scoredRes = await supabase
    .from("scored_posts")
    .select("*")
    .eq("market_id", marketId)
    .order("scored_at", { ascending: false })
    .limit(limit * 2); // Fetch extra to account for filtered retweets

  if (scoredRes.error) throw scoredRes.error;

  const rawIds = Array.from(new Set((scoredRes.data ?? []).map((p) => p.raw_post_id)));
  
  // Get raw posts, excluding simple retweets (but including quote retweets)
  const rawRes = await supabase
    .from("raw_posts")
    .select("*")
    .in("id", rawIds)
    .or("is_retweet.eq.false,is_retweet.is.null,is_quote_retweet.eq.true");

  if (rawRes.error) throw rawRes.error;

  const rawMap = new Map<string, RawPostRow>();
  (rawRes.data ?? []).forEach((r) => rawMap.set(r.id, r as RawPostRow));

  // Filter to only include posts that have valid raw posts (not simple retweets)
  const results = (scoredRes.data ?? [])
    .map((row) => ({
      scored: row as ScoredPostRow,
      raw: rawMap.get((row as ScoredPostRow).raw_post_id) ?? null
    }))
    .filter((item) => {
      // Include if we have raw post data (it passed the retweet filter)
      if (!item.raw) return false;
      
      // Double check: exclude simple retweets (is_retweet=true AND is_quote_retweet=false/null)
      if (item.raw.is_retweet === true && item.raw.is_quote_retweet !== true) {
        return false;
      }
      
      return true;
    })
    .slice(0, limit); // Apply the original limit after filtering

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
