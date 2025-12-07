import { z } from "zod";

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
  cascade_scenarios: z.array(z.string()) // "If A resolves YES, expect B to move +15%"
});

export type CorrelationInsight = z.infer<typeof CorrelationInsightSchema>;
export type RelatedMarket = CorrelationInsight["related_markets"][number];
export type CorrelationType = RelatedMarket["correlation_type"];
