import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type ScoredRow = {
  id: string;
  raw_post_id: string;
  market_id: string;
  scores: Record<string, { relevance?: number }>;
  display_labels: {
    summary?: string;
    reason?: string;
    credibility_label?: string;
    stance_label?: string;
  } | null;
  scored_at: string;
};

type RawRow = {
  id: string;
  market_id: string;
  x_post_id: string | null;
  text: string | null;
  author_id: string | null;
  author_followers: number | null;
  is_retweet: boolean | null;
  is_quote_retweet: boolean | null;
};

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function isSimpleRetweet(raw: RawRow) {
  if (raw.is_retweet === true && raw.is_quote_retweet !== true) return true;
  if (raw.text && raw.text.trim().startsWith("RT @")) return true;
  return false;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) return json({ posts: [], error: "Database not configured" }, 503);

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10), 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

  // Fetch scored posts (grab extra to account for retweet filtering)
  const { data: scoredRes, error: scoredErr } = await supabase
    .from("scored_posts")
    .select("*")
    .eq("market_id", marketId)
    .order("scored_at", { ascending: false })
    .range(offset, offset + limit * 3 - 1);

  if (scoredErr) {
    return json({ posts: [], error: "Failed to fetch scored posts" }, 500);
  }

  const scored = (scoredRes ?? []) as ScoredRow[];
  const rawIds = Array.from(new Set(scored.map((s) => s.raw_post_id)));

  const { data: rawRes, error: rawErr } = await supabase
    .from("raw_posts")
    .select("*")
    .in("id", rawIds);

  if (rawErr) {
    return json({ posts: [], error: "Failed to fetch raw posts" }, 500);
  }

  const rawMap = new Map<string, RawRow>();
  (rawRes ?? []).forEach((r) => rawMap.set(r.id, r as RawRow));

  const seenX = new Set<string>();
  const posts = scored
    .map((s) => {
      const raw = rawMap.get(s.raw_post_id);
      if (!raw) return null;
      if (isSimpleRetweet(raw)) return null;
      if (raw.x_post_id) {
        if (seenX.has(raw.x_post_id)) return null;
        seenX.add(raw.x_post_id);
      }
      return {
        id: s.id,
        x_post_id: raw.x_post_id,
        text: raw.text,
        author_id: raw.author_id,
        author_followers: raw.author_followers,
        scored_at: s.scored_at,
        stance_label: s.display_labels?.stance_label,
        credibility_label: s.display_labels?.credibility_label,
        summary: s.display_labels?.summary,
        reason: s.display_labels?.reason,
        relevance_score: (s.scores as Record<string, { relevance?: number }> | null)?.relevance ?? 0,
      };
    })
    .filter(Boolean)
    .slice(0, limit);

  return json({ posts });
}

