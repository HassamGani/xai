import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

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
        { error: "Grok API key not configured" },
        { status: 503 }
      );
    }

    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // Get current market details
    const { data: currentMarket, error: marketError } = await supabase
      .from("markets")
      .select("*")
      .eq("id", marketId)
      .single();

    if (marketError || !currentMarket) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    // Get current market outcomes with probabilities
    const { data: currentOutcomes } = await supabase
      .from("outcomes")
      .select("outcome_id, label, current_probability")
      .eq("market_id", marketId);

    // Get all other active markets (not resolved and not the current one)
    const { data: otherMarkets, error: otherMarketsError } = await supabase
      .from("markets")
      .select("id, question, normalized_question, status")
      .neq("id", marketId)
      .neq("status", "resolved")
      .order("created_at", { ascending: false })
      .limit(50); // Limit to avoid huge prompts

    if (otherMarketsError) {
      return NextResponse.json(
        { error: "Failed to fetch other markets" },
        { status: 500 }
      );
    }

    // If no other markets exist, return empty result
    if (!otherMarkets || otherMarkets.length === 0) {
      return NextResponse.json({
        related_markets: [],
        cascade_scenarios: [],
        message: "No other active markets to analyze"
      });
    }

    // Get outcomes for all other markets
    const otherMarketIds = otherMarkets.map((m) => m.id);
    const { data: otherOutcomes } = await supabase
      .from("outcomes")
      .select("market_id, outcome_id, label, current_probability")
      .in("market_id", otherMarketIds);

    // Group outcomes by market
    const outcomesByMarket = new Map<
      string,
      Array<{ outcome_id: string; label: string; current_probability: number | null }>
    >();
    (otherOutcomes ?? []).forEach((o) => {
      const existing = outcomesByMarket.get(o.market_id) || [];
      existing.push({
        outcome_id: o.outcome_id,
        label: o.label,
        current_probability: o.current_probability
      });
      outcomesByMarket.set(o.market_id, existing);
    });

    // Format current market context
    const currentOutcomesStr = (currentOutcomes ?? [])
      .map(
        (o) =>
          `- ${o.label}: ${((o.current_probability ?? 0) * 100).toFixed(1)}%`
      )
      .join("\n");

    // Format other markets context
    const otherMarketsStr = otherMarkets
      .map((m) => {
        const outcomes = outcomesByMarket.get(m.id) || [];
        const outcomesStr = outcomes
          .map(
            (o) =>
              `${o.label}: ${((o.current_probability ?? 0) * 100).toFixed(1)}%`
          )
          .join(", ");
        return `- ID: ${m.id}\n  Question: ${m.normalized_question || m.question}\n  Outcomes: [${outcomesStr}]`;
      })
      .join("\n\n");

    const systemPrompt = `You are an expert at analyzing prediction markets and identifying causal relationships between events.

Given a primary market and a list of other active markets, identify:
1. Markets that are correlated with the primary market
2. The type of correlation (causal, inverse, leading_indicator, lagging_indicator)
3. Cascade scenarios that describe how outcomes in one market would affect others

Correlation types:
- causal: One market's outcome directly causes changes in another
- inverse: Markets move in opposite directions
- leading_indicator: One market tends to predict movements in another before they happen
- lagging_indicator: One market follows trends from another with a delay

Output ONLY valid JSON matching this schema:
{
  "related_markets": [
    {
      "market_id": "uuid of related market",
      "correlation_type": "causal|inverse|leading_indicator|lagging_indicator",
      "explanation": "Brief explanation of the relationship"
    }
  ],
  "cascade_scenarios": [
    "If [Market A outcome] happens, expect [Market B] to move [direction] because [reason]"
  ]
}

Rules:
- Only include markets with meaningful correlations (don't force relationships)
- Be specific about causality chains
- Keep explanations concise but insightful
- Include 0-5 related markets (only truly related ones)
- Include 0-5 cascade scenarios
- Use actual market IDs from the provided list`;

    const userPrompt = `Analyze correlations for this primary market:

**Primary Market**
Question: ${currentMarket.normalized_question || currentMarket.question}
Current Probabilities:
${currentOutcomesStr}

**Other Active Markets**
${otherMarketsStr}

Identify causal relationships and cascade scenarios between the primary market and the others.`;

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
        temperature: 0.3,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Grok API error:", response.status, err);
      return NextResponse.json(
        { error: `Grok API error: ${response.status}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "No response from Grok" },
        { status: 500 }
      );
    }

    // Parse and validate JSON response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    try {
      const parsed = JSON.parse(jsonStr.trim());
      const validated = CorrelationInsightSchema.parse(parsed);

      // Filter out any market IDs that don't exist in our list
      const validMarketIds = new Set(otherMarkets.map((m) => m.id));
      const filteredMarkets = validated.related_markets.filter((rm) =>
        validMarketIds.has(rm.market_id)
      );

      // Enrich related markets with question text for display
      const enrichedMarkets = filteredMarkets.map((rm) => {
        const market = otherMarkets.find((m) => m.id === rm.market_id);
        return {
          ...rm,
          question: market?.normalized_question || market?.question || "Unknown market"
        };
      });

      return NextResponse.json({
        related_markets: enrichedMarkets,
        cascade_scenarios: validated.cascade_scenarios,
        analyzed_at: new Date().toISOString()
      });
    } catch (parseError) {
      console.error("Failed to parse Grok response:", parseError, content);
      return NextResponse.json(
        { error: "Failed to parse correlation analysis" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Correlations endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
