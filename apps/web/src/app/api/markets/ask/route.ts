import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { createMarketFromQuestion, checkSemanticSimilarity } from "@/lib/grok";
import { z } from "zod";

const AskRequestSchema = z.object({
  question: z.string().min(10, "Question must be at least 10 characters").max(500, "Question must be under 500 characters")
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question } = AskRequestSchema.parse(body);

    // Use admin client for write operations (bypasses RLS)
    const supabase = getSupabaseAdmin() || getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Step 1: Get existing markets for similarity check
    const { data: existingMarkets, error: fetchError } = await supabase
      .from("markets")
      .select("id, question, normalized_question")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50);

    if (fetchError) {
      console.error("Error fetching existing markets:", fetchError);
      return NextResponse.json({ error: "Failed to check existing markets" }, { status: 500 });
    }

    // Step 2: Check semantic similarity
    const similarity = await checkSemanticSimilarity(question, existingMarkets ?? []);

    if (similarity.isSimilar && similarity.matchedMarketId) {
      return NextResponse.json({
        action: "existing",
        marketId: similarity.matchedMarketId,
        message: `A similar market already exists: ${similarity.reasoning}`
      });
    }

    // Step 3: Create new market using Grok
    let marketData;
    try {
      marketData = await createMarketFromQuestion(question);
    } catch (grokError) {
      console.error("Grok API error:", grokError);
      return NextResponse.json(
        { error: "Failed to analyze question. Please try again." },
        { status: 500 }
      );
    }

    // Normalize rule templates to avoid noisy retweets and prefer English
    const normalizedRuleTemplates = (marketData.x_rule_templates || []).map((tpl: string) => {
      const hasRetweetFilter = tpl.toLowerCase().includes("is:retweet");
      const hasLang = tpl.toLowerCase().includes("lang:");
      return `${tpl}${hasRetweetFilter ? "" : " -is:retweet"}${hasLang ? "" : " lang:en"}`.trim();
    });

    // Step 4: Insert market with resolution fields
    const { data: market, error: marketError } = await supabase
      .from("markets")
      .insert({
        question: question,
        normalized_question: marketData.normalized_question,
        status: "active",
        x_rule_templates: normalizedRuleTemplates,
        total_posts_processed: 0,
        estimated_resolution_date: marketData.estimated_resolution_date,
        resolution_criteria: marketData.resolution_criteria
      })
      .select()
      .single();

    if (marketError || !market) {
      console.error("Error creating market:", marketError);
      return NextResponse.json({ error: "Failed to create market" }, { status: 500 });
    }

    // Step 5: Insert outcomes
    const outcomesToInsert = marketData.outcomes.map((o) => ({
      market_id: market.id,
      outcome_id: o.outcome_id,
      label: o.label,
      current_probability: o.prior_probability,
      cumulative_support: 0,
      cumulative_oppose: 0,
      post_count: 0
    }));

    const { error: outcomesError } = await supabase.from("outcomes").insert(outcomesToInsert);

    if (outcomesError) {
      console.error("Error creating outcomes:", outcomesError);
      await supabase.from("markets").delete().eq("id", market.id);
      return NextResponse.json({ error: "Failed to create market outcomes" }, { status: 500 });
    }

    // Step 6: Create initial probability snapshot
    const initialProbabilities: Record<string, number> = {};
    for (const o of marketData.outcomes) {
      initialProbabilities[o.outcome_id] = o.prior_probability;
    }

    await supabase.from("probability_snapshots").insert({
      market_id: market.id,
      probabilities: initialProbabilities
    });

    // Step 7: Create initial market state
    await supabase.from("market_state").upsert({
      market_id: market.id,
      probabilities: initialProbabilities,
      updated_at: new Date().toISOString()
    });

    // Step 8: Activate X filtered stream for this market
    let streamActivated = false;
    try {
      const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
      if (X_BEARER_TOKEN && normalizedRuleTemplates.length > 0) {
        const rules = normalizedRuleTemplates.map((template: string, index: number) => ({
          value: template,
          tag: `market:${market.id}:${index}`,
        }));

        console.log(`[ask] Activating stream for market ${market.id} with ${rules.length} rules`);

        const addResponse = await fetch(
          "https://api.twitter.com/2/tweets/search/stream/rules",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${X_BEARER_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ add: rules }),
          }
        );

        if (addResponse.ok) {
          const result = await addResponse.json();
          console.log("[ask] Stream rules activated:", result.meta);
          streamActivated = true;

          // Update market to mark stream as active
          await supabase.from("markets").update({ stream_active: true }).eq("id", market.id);
        } else {
          const errorText = await addResponse.text();
          console.error("[ask] Failed to activate stream:", errorText);
        }
      }
    } catch (streamError) {
      console.error("[ask] Error activating stream:", streamError);
      // Don't fail the whole request if stream activation fails
    }

    return NextResponse.json({
      action: "created",
      marketId: market.id,
      market: {
        id: market.id,
        question: market.question,
        normalized_question: market.normalized_question,
        estimated_resolution_date: market.estimated_resolution_date,
        resolution_criteria: market.resolution_criteria,
        outcomes: marketData.outcomes,
        x_rule_templates: marketData.x_rule_templates
      },
      streamActivated,
      message: streamActivated 
        ? "Market created and X stream activated! Tweets will start appearing shortly."
        : "Market created successfully (stream activation pending)"
    });
  } catch (error) {
    console.error("Ask endpoint error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
