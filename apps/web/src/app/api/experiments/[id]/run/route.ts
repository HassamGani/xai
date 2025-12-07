import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { softmax } from "@/lib/probability-utils";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const X_SEARCH_URL = "https://api.twitter.com/2/tweets/search/all";

const paramsSchema = z.object({ id: z.string().uuid() });

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

    // Build search params
    const searchParams = new URLSearchParams();
    searchParams.set("query", queryJson?.query || exp.normalized_question || exp.question);
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
    const posts = (searchJson.data || []) as Array<{
      id: string;
      text: string;
      author_id: string;
      created_at: string;
      public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number };
    }>;
    // Cap posts to avoid timeouts
    const limitedPosts = posts.slice(0, 150);
    const users = new Map(
      ((searchJson.includes?.users || []) as Array<{ id: string; username?: string; public_metrics?: { followers_count?: number } }>)
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
      const pm = row.post.public_metrics || {};
      const followers = users.get(row.post.author_id)?.public_metrics?.followers_count || 0;
      const weight = Math.log10(Math.max(followers, 10)) / 5; // mild weight
      for (const label of labels) {
        const s = row.scores[label] as any;
        if (!s || typeof s !== "object") continue;
        const delta =
          (s.relevance ?? 0) *
          (Math.abs(s.stance ?? 0)) *
          (s.strength ?? 0) *
          (s.credibility ?? 1) *
          (s.stance ?? 0 >= 0 ? 1 : -1) *
          (1 + weight);
        evidence[label] = (evidence[label] || 0) + delta;
      }
      // snapshot after each post
      const probs = softmax(evidence);
      snapshotRows.push({
        experiment_id: id,
        timestamp: new Date(row.post.created_at).toISOString(),
        probabilities: probs
      });
    }

    if (snapshotRows.length === 0) {
      await supabase.from("experiment_runs").update({ status: "failed", error: "No snapshots" }).eq("id", runId);
      return NextResponse.json({ error: "No snapshots generated" }, { status: 500 });
    }

    // Store posts and snapshots
    const postRows = scoredRows.map((row) => {
      const author = users.get(row.post.author_id);
      return {
        experiment_id: id,
        x_post_id: row.post.id,
        text: row.post.text,
        author_id: row.post.author_id,
        author_username: author?.username || null,
        author_followers: author?.public_metrics?.followers_count || null,
        post_created_at: row.post.created_at,
        metrics: row.post.public_metrics || {},
        scores: row.scores,
        display_labels: row.display_labels || null
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

