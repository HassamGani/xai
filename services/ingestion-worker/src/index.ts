import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// Environment validation
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  X_BEARER_TOKEN: z.string().min(1),
  GROK_API_KEY: z.string().min(1),
});

const env = envSchema.parse(process.env);

// Initialize Supabase client
const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

// Types
interface Market {
  id: string;
  question: string;
  normalized_question: string | null;
  x_rule_templates: string[] | null;
  status: string;
}

interface Outcome {
  id: string;
  outcome_id: string;
  label: string;
  current_probability: number;
}

interface StreamRule {
  id?: string;
  value: string;
  tag: string;
}

// X API endpoints
const X_API_BASE = "https://api.twitter.com/2";
const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

// Grok scoring schema
const GrokScoreSchema = z.object({
  relevance: z.number().min(0).max(1),
  stance: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1),
  credibility: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

const GrokResponseSchema = z.object({
  scores: GrokScoreSchema,
  display_labels: z.object({
    summary: z.string(),
    reason: z.string(),
    credibility_label: z.enum(["High", "Medium", "Low"]),
    stance_label: z.string(),
  }),
  flags: z.object({
    is_sarcasm: z.boolean(),
    is_question: z.boolean(),
    is_rumor: z.boolean(),
  }).optional(),
});

// Logger
function log(level: "INFO" | "ERROR" | "WARN" | "DEBUG", message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

// Fetch active markets
async function getActiveMarkets(): Promise<Market[]> {
  const { data, error } = await supabase
    .from("markets")
    .select("id, question, normalized_question, x_rule_templates, status")
    .eq("status", "active");

  if (error) {
    log("ERROR", "Failed to fetch markets", { error });
    return [];
  }

  return data || [];
}

// Fetch outcomes for a market
async function getOutcomes(marketId: string): Promise<Outcome[]> {
  const { data, error } = await supabase
    .from("outcomes")
    .select("id, outcome_id, label, current_probability")
    .eq("market_id", marketId);

  if (error) {
    log("ERROR", "Failed to fetch outcomes", { error, marketId });
    return [];
  }

  return data || [];
}

// X API: Get current rules
async function getCurrentRules(): Promise<StreamRule[]> {
  const response = await fetch(`${X_API_BASE}/tweets/search/stream/rules`, {
    headers: {
      Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    log("ERROR", "Failed to get stream rules", { status: response.status, body: text });
    return [];
  }

  const data = await response.json();
  return data.data || [];
}

// X API: Add rules
async function addRules(rules: { value: string; tag: string }[]): Promise<void> {
  if (rules.length === 0) return;

  const response = await fetch(`${X_API_BASE}/tweets/search/stream/rules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ add: rules }),
  });

  if (!response.ok) {
    const text = await response.text();
    log("ERROR", "Failed to add stream rules", { status: response.status, body: text });
    return;
  }

  const data = await response.json();
  log("INFO", "Added stream rules", { meta: data.meta });
}

// X API: Delete rules
async function deleteRules(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const response = await fetch(`${X_API_BASE}/tweets/search/stream/rules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ delete: { ids } }),
  });

  if (!response.ok) {
    const text = await response.text();
    log("ERROR", "Failed to delete stream rules", { status: response.status, body: text });
  }
}

// Sync rules with active markets
async function syncRules(markets: Market[]): Promise<void> {
  const currentRules = await getCurrentRules();
  const currentTags = new Set(currentRules.map((r) => r.tag));

  // Build desired rules
  const desiredRules: { value: string; tag: string }[] = [];
  for (const market of markets) {
    if (!market.x_rule_templates || market.x_rule_templates.length === 0) continue;

    for (let i = 0; i < market.x_rule_templates.length; i++) {
      const tag = `market:${market.id}:${i}`;
      if (!currentTags.has(tag)) {
        desiredRules.push({
          value: market.x_rule_templates[i],
          tag,
        });
      }
    }
  }

  // Delete rules for inactive markets
  const activeMarketIds = new Set(markets.map((m) => m.id));
  const rulesToDelete = currentRules
    .filter((r) => {
      const match = r.tag.match(/^market:([^:]+):/);
      return match && !activeMarketIds.has(match[1]);
    })
    .map((r) => r.id!)
    .filter(Boolean);

  if (rulesToDelete.length > 0) {
    await deleteRules(rulesToDelete);
    log("INFO", "Deleted inactive rules", { count: rulesToDelete.length });
  }

  // Add new rules
  if (desiredRules.length > 0) {
    await addRules(desiredRules);
    log("INFO", "Added new rules", { count: desiredRules.length });
  }
}

// Score a tweet with Grok
async function scoreTweet(
  tweet: { text: string; author_id: string },
  market: Market,
  outcomes: Outcome[]
): Promise<z.infer<typeof GrokResponseSchema> | null> {
  const outcomesStr = outcomes.map((o) => `- ${o.outcome_id}: "${o.label}"`).join("\n");

  const systemPrompt = `You are an evidence-scoring engine for a prediction market.

Given a tweet and a market question with outcomes, score how relevant and influential this tweet is.

Output ONLY valid JSON:
{
  "scores": {
    "relevance": 0.0-1.0 (how relevant is this tweet to the question),
    "stance": -1.0 to 1.0 (negative=against leading outcome, positive=supports leading),
    "strength": 0.0-1.0 (how strong is the evidence),
    "credibility": 0.0-1.0 (how credible is this source),
    "confidence": 0.0-1.0 (your confidence in this scoring)
  },
  "display_labels": {
    "summary": "One sentence neutral summary of the tweet",
    "reason": "Why this tweet matters for this market",
    "credibility_label": "High" | "Medium" | "Low",
    "stance_label": "Bullish on X" | "Bearish on X" | "Neutral" | "Mixed"
  },
  "flags": {
    "is_sarcasm": true/false,
    "is_question": true/false,
    "is_rumor": true/false
  }
}`;

  const userPrompt = `Market Question: ${market.question}
${market.normalized_question ? `Normalized: ${market.normalized_question}` : ""}

Outcomes:
${outcomesStr}

Tweet by @${tweet.author_id}:
"${tweet.text}"

Score this tweet.`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3-latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      log("ERROR", "Grok API error", { status: response.status });
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Parse JSON from response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const parsed = JSON.parse(jsonStr.trim());
    return GrokResponseSchema.parse(parsed);
  } catch (error) {
    log("ERROR", "Failed to score tweet", { error });
    return null;
  }
}

// Process a single tweet
async function processTweet(
  tweet: {
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics?: {
      retweet_count: number;
      reply_count: number;
      like_count: number;
      quote_count: number;
    };
  },
  matchingRules: { tag: string }[]
): Promise<void> {
  // Extract market IDs from matching rules
  const marketIds = new Set<string>();
  for (const rule of matchingRules) {
    const match = rule.tag.match(/^market:([^:]+):/);
    if (match) marketIds.add(match[1]);
  }

  for (const marketId of marketIds) {
    // Check if tweet already exists
    const { data: existing } = await supabase
      .from("raw_posts")
      .select("id")
      .eq("x_post_id", tweet.id)
      .eq("market_id", marketId)
      .single();

    if (existing) {
      log("DEBUG", "Tweet already exists", { x_post_id: tweet.id, marketId });
      continue;
    }

    // Check if it's a retweet
    const isRetweet = tweet.text.trim().startsWith("RT @");
    const isQuoteRetweet = false; // Would need to check referenced_tweets

    // Get market and outcomes
    const { data: market } = await supabase
      .from("markets")
      .select("*")
      .eq("id", marketId)
      .single();

    if (!market || market.status !== "active") continue;

    const outcomes = await getOutcomes(marketId);
    if (outcomes.length === 0) continue;

    // Insert raw post
    const { data: rawPost, error: rawError } = await supabase
      .from("raw_posts")
      .insert({
        market_id: marketId,
        x_post_id: tweet.id,
        text: tweet.text,
        author_id: tweet.author_id,
        post_created_at: tweet.created_at,
        metrics: tweet.public_metrics || {},
        is_retweet: isRetweet,
        is_quote_retweet: isQuoteRetweet,
      })
      .select()
      .single();

    if (rawError) {
      log("ERROR", "Failed to insert raw post", { error: rawError });
      continue;
    }

    log("INFO", "Inserted raw post", { x_post_id: tweet.id, marketId, rawPostId: rawPost.id });

    // Skip scoring for simple retweets
    if (isRetweet && !isQuoteRetweet) {
      log("DEBUG", "Skipping scoring for simple retweet", { x_post_id: tweet.id });
      continue;
    }

    // Score with Grok
    const scoreResult = await scoreTweet(
      { text: tweet.text, author_id: tweet.author_id },
      market,
      outcomes
    );

    if (!scoreResult) {
      log("WARN", "Failed to score tweet", { x_post_id: tweet.id });
      continue;
    }

    // Insert scored post
    const { error: scoreError } = await supabase.from("scored_posts").insert({
      raw_post_id: rawPost.id,
      market_id: marketId,
      outcome_id: outcomes[0].outcome_id, // Primary outcome
      scores: scoreResult.scores,
      display_labels: scoreResult.display_labels,
      flags: scoreResult.flags,
    });

    if (scoreError) {
      log("ERROR", "Failed to insert scored post", { error: scoreError });
      continue;
    }

    log("INFO", "Scored tweet", {
      x_post_id: tweet.id,
      marketId,
      relevance: scoreResult.scores.relevance,
    });

    // Update probability if relevant enough
    if (scoreResult.scores.relevance >= 0.3) {
      await updateProbability(marketId, outcomes, scoreResult.scores);
    }

    // Update market post count
    await supabase
      .from("markets")
      .update({ total_posts_processed: (market.total_posts_processed || 0) + 1 })
      .eq("id", marketId);
  }
}

// Update market probability based on new evidence
async function updateProbability(
  marketId: string,
  outcomes: Outcome[],
  scores: z.infer<typeof GrokScoreSchema>
): Promise<void> {
  // Get current state
  const { data: state } = await supabase
    .from("market_state")
    .select("probabilities")
    .eq("market_id", marketId)
    .single();

  const currentProbs: Record<string, number> = state?.probabilities || {};

  // Initialize if empty
  if (Object.keys(currentProbs).length === 0) {
    for (const o of outcomes) {
      currentProbs[o.outcome_id] = o.current_probability || 1 / outcomes.length;
    }
  }

  // Apply Bayesian-ish update based on stance and strength
  const updateStrength = scores.relevance * scores.strength * scores.credibility * 0.05;
  const stanceDirection = scores.stance;

  // Simple update: shift probabilities based on stance
  const outcomeIds = Object.keys(currentProbs);
  if (outcomeIds.length >= 2) {
    const primary = outcomeIds[0];
    const secondary = outcomeIds[1];

    const shift = updateStrength * stanceDirection;
    currentProbs[primary] = Math.max(0.01, Math.min(0.99, currentProbs[primary] + shift));
    currentProbs[secondary] = Math.max(0.01, Math.min(0.99, currentProbs[secondary] - shift));

    // Normalize
    const total = Object.values(currentProbs).reduce((a, b) => a + b, 0);
    for (const key of outcomeIds) {
      currentProbs[key] = currentProbs[key] / total;
    }
  }

  // Upsert market state
  await supabase.from("market_state").upsert({
    market_id: marketId,
    probabilities: currentProbs,
    updated_at: new Date().toISOString(),
  });

  // Insert snapshot
  await supabase.from("probability_snapshots").insert({
    market_id: marketId,
    probabilities: currentProbs,
  });

  log("INFO", "Updated probabilities", { marketId, probabilities: currentProbs });
}

// Connect to filtered stream
async function connectToStream(): Promise<void> {
  const url = new URL(`${X_API_BASE}/tweets/search/stream`);
  url.searchParams.set("tweet.fields", "author_id,created_at,public_metrics,referenced_tweets");
  url.searchParams.set("expansions", "author_id,referenced_tweets.id");
  url.searchParams.set("user.fields", "verified,public_metrics");

  log("INFO", "Connecting to X filtered stream...");

  while (true) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        log("ERROR", "Stream connection failed", { status: response.status, body: text });

        // Rate limit handling
        if (response.status === 429) {
          const resetTime = response.headers.get("x-rate-limit-reset");
          const waitMs = resetTime ? (parseInt(resetTime) * 1000 - Date.now()) : 60000;
          log("WARN", "Rate limited, waiting", { waitMs });
          await sleep(Math.max(waitMs, 5000));
        } else {
          await sleep(5000);
        }
        continue;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        log("ERROR", "No response body reader");
        await sleep(5000);
        continue;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      log("INFO", "Connected to stream");

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          log("WARN", "Stream ended");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);

            if (data.data) {
              const tweet = data.data;
              const matchingRules = data.matching_rules || [];

              log("INFO", "Received tweet", {
                id: tweet.id,
                author_id: tweet.author_id,
                rules: matchingRules.map((r: any) => r.tag),
              });

              await processTweet(tweet, matchingRules);
            }
          } catch (parseError) {
            if (line.trim() !== "") {
              log("DEBUG", "Non-JSON line", { line: line.slice(0, 100) });
            }
          }
        }
      }
    } catch (error) {
      log("ERROR", "Stream error", { error: String(error) });
      await sleep(5000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main entry point
async function main(): Promise<void> {
  log("INFO", "Starting ingestion worker");

  // Initial sync of rules
  const markets = await getActiveMarkets();
  log("INFO", "Found active markets", { count: markets.length });

  await syncRules(markets);

  // Periodically sync rules (every 5 minutes)
  setInterval(async () => {
    const updatedMarkets = await getActiveMarkets();
    await syncRules(updatedMarkets);
  }, 5 * 60 * 1000);

  // Connect to stream
  await connectToStream();
}

main().catch((error) => {
  log("ERROR", "Fatal error", { error: String(error) });
  process.exit(1);
});

