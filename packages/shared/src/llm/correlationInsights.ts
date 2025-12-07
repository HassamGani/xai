import { z } from "zod";

/**
 * Schema for Grok's cross-market correlation analysis response.
 * Used to validate LLM output when identifying related markets
 * with correlated probability movements and causality chains.
 */
export const CorrelationInsightSchema = z.object({
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

export type CorrelationInsight = z.infer<typeof CorrelationInsightSchema>;
export type CorrelationType = CorrelationInsight["related_markets"][number]["correlation_type"];
