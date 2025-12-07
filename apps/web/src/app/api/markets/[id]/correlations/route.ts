import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

/**
 * Schema for Grok's cross-market correlation analysis response.
 */
const CorrelationInsightSchema = z.object({
  related_markets: z.array(
    z.object({
      market_id: z.string(),
      correlation_type: z.enum([
        "causal",
        "inverse",
        "leading_indicator",
        "lagging_indicator"
      ]),
      explanation: z.string()
    })
  ),
  cascade_scenarios: z.array(z.string())
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const marketId = params.id;
    const apiKey = process.env.GROK_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Grok API key not configured. Add GROK_API_KEY to environment variables." },
        { status: 503 }
      );
    }

    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Fetch current market details
    const { data: market, error: marketError } = await supabase
      .from("markets")
      .select("*")
      .eq("id", marketId)
      .single();

    if (marketError || !market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    // Fetch current market outcomes + probabilities
    const { data: outcomes } = await supabase
      .from("outcomes")
      .select("outcome_id, label, current_probability")
      .eq("market_id", marketId);

    // Fetch all other active markets (not resolved)
    const { data: otherMarkets, error: otherMarketsError } = await supabase
      .from("markets")
      .select("id, question, normalized_question, status, created_at")
      .neq("id", marketId)
      .neq("status", "resolved")
      .order("created_at", { ascending: false })
      .limit(50);

    if (otherMarketsError) {
      console.error("Error fetching other markets:", otherMarketsError);
      return NextResponse.json({ error: "Failed to fetch markets" }, { status: 500 });
    }

    // Handle case where no other active markets exist
    if (!otherMarkets || otherMarkets.length === 0) {
      return NextResponse.json({
        related_markets: [],
        cascade_scenarios: [],
        generated_at: new Date().toISOString(),
        market_id: marketId,
        message: "No other active markets found for correlation analysis"
      });
    }

    // Format current market info
    const currentMarketInfo = `
Question: "${market.question}"
${market.normalized_question ? `Normalized: "${market.normalized_question}"` : ""}
Outcomes: ${(outcomes ?? []).map((o) => `${o.label} (${((o.current_probability ?? 0) * 100).toFixed(1)}%)`).join(", ")}
    `.trim();

    // Format list of other active markets
    const otherMarketsInfo = otherMarkets
      .map((m, idx) => `${idx + 1}. [ID: ${m.id}] "${m.question}"${m.normalized_question ? ` (${m.normalized_question})` : ""}`)
      .join("\n");

    const systemPrompt = `You are an expert analyst specializing in prediction market correlations and causal relationships.

Your task is to identify which markets from a given list are related to a target market, and explain their relationships.

For each related market, classify the relationship as one of:
- "causal": Changes in one directly cause changes in the other
- "inverse": Markets move in opposite directions
- "leading_indicator": One market tends to move before the other
- "lagging_indicator": One market tends to follow the other

Also identify potential cascade scenarios - how a resolution in one market could trigger probability changes in related markets.

Respond ONLY with valid JSON matching this exact schema:
{
  "related_markets": [
    {
      "market_id": "string (the market ID from the list)",
      "correlation_type": "causal" | "inverse" | "leading_indicator" | "lagging_indicator",
      "explanation": "string (1-2 sentences explaining the relationship)"
    }
  ],
  "cascade_scenarios": [
    "string (describe a chain reaction scenario)"
  ]
}

Guidelines:
- Only include markets that have a meaningful relationship (don't force connections)
- Be specific in explanations
- Limit to 5 most relevant related markets
- Limit to 3 cascade scenarios
- If no markets are related, return empty arrays`;

    const userPrompt = `Given the current market:
${currentMarketInfo}

Analyze which of these active markets might be correlated:
${otherMarketsInfo}

Identify causal relationships and which market movements would cascade.`;

    console.log("Calling Grok API for correlation analysis:", marketId);

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-3-latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Grok API error:", response.status, err);
      return NextResponse.json(
        { error: `Grok API error: ${response.status}. Check API key and quota.` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in Grok response:", JSON.stringify(data).slice(0, 500));
      return NextResponse.json({ error: "No analysis generated" }, { status: 500 });
    }

    // Parse and validate the JSON response
    let parsedResponse;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1].trim();
      parsedResponse = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("Failed to parse Grok response as JSON:", content);
      return NextResponse.json(
        { error: "Invalid response format from Grok" },
        { status: 500 }
      );
    }

    // Validate with Zod schema
    const validationResult = CorrelationInsightSchema.safeParse(parsedResponse);

    if (!validationResult.success) {
      console.error("Zod validation failed:", validationResult.error);
      return NextResponse.json(
        { error: "Response validation failed" },
        { status: 500 }
      );
    }

    const validated = validationResult.data;

    // Build id->question map for replacing placeholders inside cascade text
    const idToQuestion: Record<string, string> = {
      [marketId]: market.question
    };
    for (const m of otherMarkets) {
      idToQuestion[m.id] = m.question;
    }

    // Enrich related markets with question text
    const enrichedRelatedMarkets = validated.related_markets.map((rm) => {
      const marketInfo = otherMarkets.find((m) => m.id === rm.market_id);
      return {
        ...rm,
        question: marketInfo?.question ?? "Unknown market"
      };
    });

    // Replace any raw market IDs in cascade scenarios with human-readable questions
    const cascadesWithNames = validated.cascade_scenarios.map((scenario) => {
      let text = scenario;
      for (const [id, question] of Object.entries(idToQuestion)) {
        if (text.includes(id)) {
          text = text.replace(new RegExp(id, "g"), `"${question}"`);
        }
      }
      return text;
    });

    return NextResponse.json({
      related_markets: enrichedRelatedMarkets,
      cascade_scenarios: cascadesWithNames,
      generated_at: new Date().toISOString(),
      market_id: marketId
    });
  } catch (error) {
    console.error("Correlations endpoint error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
