import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { softmax } from "@/lib/probability-utils";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const X_SEARCH_URL = "https://api.twitter.com/2/tweets/search/all";

const paramsSchema = z.object({ id: z.string().uuid() });

// Helper: derive stance label from per-outcome scores
function deriveStanceLabel(
  scores: Record<string, any>,
  labels: string[]
): string | null {
  if (!scores || labels.length === 0) return null;
  let bestLabel: string | null = null;
  let maxStance = -2;
  for (const label of labels) {
    const s = scores[label];
    if (!s || typeof s !== "object") continue;
    const stance = s.stance ?? 0;
    const strength = s.strength ?? 0;
    const combined = Math.abs(stance) * strength;
    if (combined > maxStance) {
      maxStance = combined;
      bestLabel = stance >= 0 ? `Pro ${label}` : `Against ${label}`;
    }
  }
  return bestLabel;
}

// Helper: derive credibility label from scores
function deriveCredibilityLabel(
  scores: Record<string, any>,
  labels: string[]
): string | null {
  if (!scores || labels.length === 0) return null;
  let totalCred = 0;
  let count = 0;
  for (const label of labels) {
    const s = scores[label];
    if (!s || typeof s !== "object") continue;
    if (typeof s.credibility === "number") {
      totalCred += s.credibility;
      count++;
    }
  }
  if (count === 0) return null;
  const avgCred = totalCred / count;
  if (avgCred >= 0.7) return "High";
  if (avgCred <= 0.3) return "Low";
  return "Medium";
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  let runId: string | null = null;
  try {
    const apiKey = process.env.GROK_API_KEY;
    const xBearer = process.env.X_BEARER_TOKEN;
    if (!apiKey) {
      return NextResponse.json({ error: "GROK_API_KEY not configured" }, { status: 503 });
    }
    if (!xBearer) {
      return NextResponse.json({ error: "X_BEARER_TOKEN not configured" }, { status: 503 });
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
    runId = run?.id ?? null;

    // Ask Grok to produce a search query and date window
    const queryRes = await fetch(GROK_API_URL, {
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
              "You generate X search queries for backtesting resolved questions. Return strict JSON only."
          },
          {
            role: "user",
            content: `Question: "${exp.question}"
Outcomes: ${(exp.outcomes || []).map((o: any) => o.label).join(", ")}
Resolved outcome: ${exp.resolution_outcome || "unknown"}
Resolved at: ${exp.resolved_at || "unknown"}

Return JSON ONLY:
{
  "query": "x api search query string",
  "start_time": "ISO string or null",
  "end_time": "ISO string or null"
}`
          }
        ],
        temperature: 0.2,
        max_tokens: 300,
        search: true
      })
    });

    let queryJson: { query: string; start_time?: string | null; end_time?: string | null } | null = null;
    if (queryRes.ok) {
      try {
        const qJson = await queryRes.json();
        const content = qJson.choices?.[0]?.message?.content;
        if (content) {
          const match = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
          queryJson = JSON.parse(match[1]);
        }
      } catch {
        queryJson = null;
      }
    }

    // Build search params - exclude retweets and require English
    const baseQuery = queryJson?.query || exp.normalized_question || exp.question;
    const fullQuery = `${baseQuery} -is:retweet lang:en`;
    
    const searchParams = new URLSearchParams();
    searchParams.set("query", fullQuery);
    searchParams.set("max_results", "100");
    searchParams.set("tweet.fields", "author_id,created_at,public_metrics,text,referenced_tweets");
    searchParams.set("expansions", "author_id");
    searchParams.set("user.fields", "username,profile_image_url,public_metrics");
    if (queryJson?.start_time) searchParams.set("start_time", queryJson.start_time);
    if (queryJson?.end_time) searchParams.set("end_time", queryJson.end_time || exp.resolved_at || "");
    else if (exp.resolved_at) searchParams.set("end_time", exp.resolved_at);

    const searchRes = await fetch(`${X_SEARCH_URL}?${searchParams.toString()}`, {
      headers: { Authorization: `Bearer ${xBearer}` }
    });

    if (!searchRes.ok) {
      const errTxt = await searchRes.text();
      await supabase.from("experiment_runs").update({ status: "failed", error: errTxt }).eq("id", runId);
      return NextResponse.json({ error: "X search failed", details: errTxt }, { status: 502 });
    }

    const searchJson = await searchRes.json();
    let posts = (searchJson.data || []) as Array<{
      id: string;
      text: string;
      author_id: string;
      created_at: string;
      referenced_tweets?: Array<{ type: string; id: string }>;
      public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number };
    }>;

    // Filter out retweets (double-check: by text pattern and referenced_tweets)
    posts = posts.filter((p) => {
      // Skip if text starts with "RT @"
      if (p.text.startsWith("RT @")) return false;
      // Skip if it has a retweet reference
      if (p.referenced_tweets?.some((r) => r.type === "retweeted")) return false;
      return true;
    });

    // Sort posts oldest-first (chronological order like real-time ingestion)
    posts.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Cap posts and runtime to avoid timeouts
    const startedAt = Date.now();
    const TIME_BUDGET_MS = 8000;
    const POSTS_LIMIT = 30;
    const limitedPosts = posts.slice(0, POSTS_LIMIT);
    const users = new Map(
      ((searchJson.includes?.users || []) as Array<{ id: string; username?: string; profile_image_url?: string; public_metrics?: { followers_count?: number } }>)
        .map((u) => [u.id, u])
    );

    // Score each post with Grok (per outcome)
    const outcomes = (exp.outcomes || []) as Array<{ label: string }>;
    const scoredRows: Array<{
      post: any;
      scores: Record<string, number>;
      display_labels?: any;
    }> = [];

    for (const post of limitedPosts) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        break;
      }
      const author = users.get(post.author_id);
      const scoreRes = await fetch(GROK_API_URL, {
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
                "Score a tweet for multiple outcomes. Return JSON: { \"per_outcome\": { \"<label>\": { \"relevance\":0-1, \"stance\":-1..1, \"strength\":0-1, \"credibility\":0-1 } }, \"summary\": string }"
            },
            {
              role: "user",
              content: `Question: "${exp.question}"
Outcomes: ${outcomes.map((o) => o.label).join(", ")}

Tweet by @${author?.username || post.author_id}:
"${post.text}"`
            }
          ],
          temperature: 0.2,
          max_tokens: 300
        })
      });

      if (!scoreRes.ok) continue;
      let scoreJson: any = null;
      try {
        scoreJson = await scoreRes.json();
      } catch {
        continue;
      }
      const content = scoreJson.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") continue;
      try {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
        const parsed = JSON.parse(match[1]);
        if (parsed.per_outcome) {
          scoredRows.push({
            post,
            scores: parsed.per_outcome,
            display_labels: parsed.summary ? { summary: parsed.summary } : undefined
          });
        }
      } catch {
        continue;
      }
    }

    // Sort by timestamp
    scoredRows.sort(
      (a, b) => new Date(a.post.created_at).getTime() - new Date(b.post.created_at).getTime()
    );

    // Probability engine (simple evidence + softmax)
    const labels = outcomes.map((o) => o.label);
    const evidence: Record<string, number> = {};
    labels.forEach((l) => (evidence[l] = 0));

    const snapshotRows: Array<{ experiment_id: string; timestamp: string; probabilities: Record<string, number> }> = [];

    const computeProbs = () => {
      const probs = softmax(evidence);
      snapshotRows.push({
        experiment_id: id,
        timestamp: new Date().toISOString(),
        probabilities: probs
      });
    };

    for (const row of scoredRows) {
      const followers = users.get(row.post.author_id)?.public_metrics?.followers_count || 0;
      // Weight based on follower count (1.0 to 2.0 range)
      const followerWeight = 1 + Math.min(Math.log10(Math.max(followers, 10)) / 7, 1);
      
      for (const label of labels) {
        const s = row.scores[label] as any;
        if (!s || typeof s !== "object") continue;
        
        const relevance = s.relevance ?? 0;
        const stance = s.stance ?? 0; // -1 to 1: negative = against, positive = for
        const strength = s.strength ?? 0;
        const credibility = s.credibility ?? 0.5;
        
        // Skip low relevance posts
        if (relevance < 0.2) continue;
        
        // Delta = direction * magnitude
        // Positive stance adds to this outcome, negative stance subtracts
        const magnitude = relevance * strength * credibility * followerWeight;
        const delta = stance * magnitude;
        
        evidence[label] = (evidence[label] || 0) + delta;
      }
      
      // Create snapshot after processing each post
      // Use temperature 0.5 for more responsive probability changes
      const probs = softmax(evidence, 0.5);
      snapshotRows.push({
        experiment_id: id,
        timestamp: new Date(row.post.created_at).toISOString(),
        probabilities: probs
      });
    }

    if (snapshotRows.length === 0) {
      // Fallback: create a single snapshot using resolved outcome if available, else uniform
      const labels = outcomes.map((o) => o.label);
      const fallback: Record<string, number> = {};
      const resolvedLabel = exp.resolution_outcome && labels.includes(exp.resolution_outcome) ? exp.resolution_outcome : null;
      if (resolvedLabel) {
        labels.forEach((l) => (fallback[l] = l === resolvedLabel ? 1 : 0));
      } else {
        const u = labels.length > 0 ? 1 / labels.length : 0;
        labels.forEach((l) => (fallback[l] = u));
      }
      snapshotRows.push({
        experiment_id: id,
        timestamp: new Date().toISOString(),
        probabilities: fallback
      });
    }

    // Store posts and snapshots
    const postRows = scoredRows.map((row) => {
      const author = users.get(row.post.author_id);
      // Compute aggregate relevance score for sorting
      const outcomesScores = Object.values(row.scores || {}) as Array<{
        relevance?: number;
        stance?: number;
        strength?: number;
        credibility?: number;
      }>;
      const avgRelevance =
        outcomesScores.length > 0
          ? outcomesScores.reduce((sum, s) => sum + (s?.relevance ?? 0), 0) / outcomesScores.length
          : 0;
      return {
        experiment_id: id,
        x_post_id: row.post.id,
        text: row.post.text,
        author_id: row.post.author_id,
        author_username: author?.username || null,
        author_followers: author?.public_metrics?.followers_count || null,
        profile_image_url: author?.profile_image_url || null,
        post_created_at: row.post.created_at,
        metrics: row.post.public_metrics || {},
        scores: row.scores,
        display_labels: {
          ...(row.display_labels || {}),
          relevance_score: avgRelevance,
          // Derive stance/credibility labels from scores
          stance_label: deriveStanceLabel(row.scores, labels),
          credibility_label: deriveCredibilityLabel(row.scores, labels)
        }
      };
    });

    await supabase.from("experiment_posts").insert(postRows);

    const { error: snapErr } = await supabase.from("experiment_snapshots").insert(snapshotRows);
    if (snapErr) {
      await supabase.from("experiment_runs").update({ status: "failed", error: snapErr.message }).eq("id", runId);
      return NextResponse.json({ error: "Failed to store snapshots" }, { status: 500 });
    }

    // Finalize run
    await supabase
      .from("experiment_runs")
      .update({ status: "finished", finished_at: new Date().toISOString(), post_count: scoredRows.length })
      .eq("id", runId);

    return NextResponse.json({
      run_id: runId,
      snapshots: snapshotRows
    });
  } catch (error) {
    console.error("Experiment run error:", error);
    if (runId) {
      const supabase = getSupabaseAdmin();
      if (supabase) {
        await supabase
          .from("experiment_runs")
          .update({ status: "failed", error: String(error), finished_at: new Date().toISOString() })
          .eq("id", runId);
      }
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

