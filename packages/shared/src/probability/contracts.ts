import { z } from "zod";

export const scoreSchema = z.object({
  relevance: z.number().min(0).max(1),
  stance: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1),
  credibility: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional()
});

export const postInputSchema = z.object({
  id: z.string(),
  created_at_ms: z.number().nonnegative(),
  author_id: z.string(),
  author_followers: z.number().int().nonnegative().nullable().optional(),
  author_verified: z.boolean().nullable().optional(),
  author_created_at_ms: z.number().nonnegative().nullable().optional(),
  text: z.string().nullable().optional(),
  features: z
    .object({
      cashtag_count: z.number().int().nonnegative().optional(),
      url_count: z.number().int().nonnegative().optional(),
      is_reply: z.boolean().optional(),
      is_quote: z.boolean().optional()
    })
    .optional(),
  initial_metrics: z
    .object({
      likes: z.number().int().nonnegative().optional(),
      reposts: z.number().int().nonnegative().optional(),
      replies: z.number().int().nonnegative().optional(),
      quotes: z.number().int().nonnegative().optional()
    })
    .optional(),
  scores: z.record(z.string(), scoreSchema)
});

export const outcomeInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  prior_probability: z.number().min(0).max(1).nullable().optional()
});

export const probabilityEngineInputSchema = z.object({
  now_ms: z.number().nonnegative(),
  outcomes: z.array(outcomeInputSchema),
  prev_probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
  posts: z.array(postInputSchema)
});

export type Score = z.infer<typeof scoreSchema>;
export type PostInput = z.infer<typeof postInputSchema>;
export type OutcomeInput = z.infer<typeof outcomeInputSchema>;
export type ProbabilityEngineInput = z.infer<typeof probabilityEngineInputSchema>;

