import { z } from "zod";

export const grokScoresSchema = z.object({
  relevance: z.number().min(0).max(1),
  stance: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1),
  credibility: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional()
});

export const grokResultSchema = z.object({
  post_id: z.string(),
  per_outcome: z.record(z.string(), grokScoresSchema),
  flags: z
    .object({
      is_sarcasm: z.boolean().optional(),
      is_question: z.boolean().optional(),
      is_quote: z.boolean().optional(),
      is_rumor_style: z.boolean().optional()
    })
    .optional(),
  display_labels: z
    .object({
      summary: z.string().optional(),
      reason: z.string().optional(),
      credibility_label: z.string().optional(),
      stance_label: z.string().optional()
    })
    .optional()
});

export const grokBatchResponseSchema = z.object({
  results: z.array(grokResultSchema)
});

export type GrokScores = z.infer<typeof grokScoresSchema>;
export type GrokResult = z.infer<typeof grokResultSchema>;
export type GrokBatchResponse = z.infer<typeof grokBatchResponseSchema>;

