import { z } from "zod";

/**
 * Intent schema for natural language market Q&A.
 * Grok should classify the user's query into one of a few actionable intents
 * so the API can run deterministic DB lookups.
 */
export const MarketQaIntentSchema = z.object({
  intent: z.enum(["top_movers", "drivers", "find_correlations", "search"]),
  topics: z.array(z.string().min(1)).max(5).optional(),
  time_window_days: z.number().int().min(1).max(30).default(7),
  limit: z.number().int().min(1).max(10).default(5),
  needs_posts: z.boolean().optional(),
  focus_market_ids: z.array(z.string()).max(10).optional(),
  ask_for_reason: z.boolean().optional()
});

export const MarketQaAnswerSchema = z.object({
  summary: z.string(),
  market_ids: z.array(z.string()).default([]),
  followups: z.array(z.string()).optional()
});

export type MarketQaIntent = z.infer<typeof MarketQaIntentSchema>;
export type MarketQaAnswer = z.infer<typeof MarketQaAnswerSchema>;

/**
 * System prompt for Grok intent classification.
 */
export function marketQaIntentPrompt(todayIso: string) {
  return `You route user questions about prediction markets to structured intents.
Today's date is ${todayIso}.

Intents:
- "top_movers": they want markets with the biggest probability changes over a recent window
- "drivers": they want to know WHY a market moved (needs supporting posts)
- "find_correlations": they want markets related to a topic or to each other
- "search": general search/browse by topic if nothing else fits

Rules:
- Always return strict JSON matching the provided schema keys (no prose).
- Include topics as short nouns/phrases (no punctuation).
- Default time_window_days to 7 if missing.
- Limit is max 10; default 5.
- needs_posts = true when asking for reasons/why.
- focus_market_ids only when the user mentioned a specific market id(s).
- ask_for_reason when they explicitly want an explanation back from the model.

Example output:
{
  "intent": "top_movers",
  "topics": ["elections", "biden"],
  "time_window_days": 7,
  "limit": 5,
  "needs_posts": false,
  "focus_market_ids": [],
  "ask_for_reason": false
}`;
}
