/**
 * ML Service Types
 * TypeScript types for the ML feedback loop service
 */

import { z } from "zod";

// ============================================================================
// Request/Response Schemas
// ============================================================================

export const PostFeaturesSchema = z.object({
  relevance: z.number().min(0).max(1).default(0),
  stance: z.number().min(-1).max(1).default(0),
  strength: z.number().min(0).max(1).default(0),
  credibility: z.number().min(0).max(1).default(0),
  confidence: z.number().min(0).max(1).default(0),
  log_followers: z.number().default(0),
  author_verified: z.boolean().default(false),
});

export const MarketFeaturesSchema = z.object({
  K: z.number().int().min(2).default(2),
  duration_days: z.number().default(0),
  avg_posts_per_hour: z.number().default(0),
  topic: z.string().optional(),
});

export const RecentSummarySchema = z.object({
  Wbatch: z.number().default(0),
  last_hour_delta: z.number().default(0),
  top_post_features: z.array(PostFeaturesSchema).default([]),
});

export const CorrectionRequestSchema = z.object({
  market_id: z.string().uuid(),
  current_probabilities: z.record(z.string(), z.number()),
  market_features: MarketFeaturesSchema,
  recent_summary: RecentSummarySchema,
});

export const CorrectionResponseSchema = z.object({
  probabilities_corrected: z.record(z.string(), z.number()),
  model_version: z.string(),
  confidence: z.number(),
  explain: z.record(z.string(), z.number()).optional(),
});

export const MetaParamsRequestSchema = z.object({
  market_id: z.string().uuid(),
  market_features: MarketFeaturesSchema,
});

export const MetaParamsResponseSchema = z.object({
  temperature: z.number().default(1.0),
  beta: z.number().default(0.2),
  W_min: z.number().default(0.01),
  model_version: z.string(),
});

export const PostUsefulnessRequestSchema = z.object({
  post_features: PostFeaturesSchema,
  market_context: MarketFeaturesSchema,
  prob_before: z.number().min(0).max(1).default(0.5),
});

export const PostUsefulnessResponseSchema = z.object({
  usefulness_score: z.number(),
  move_toward_truth_prob: z.number(),
  model_version: z.string(),
});

export const TrainingStatusSchema = z.object({
  resolved_markets: z.number(),
  training_posts: z.number(),
  models_available: z.array(z.record(z.string(), z.unknown())),
  can_train_gbdt: z.boolean(),
  can_train_nn: z.boolean(),
  last_trained: z.string().nullable(),
});

// ============================================================================
// Inferred Types
// ============================================================================

export type PostFeatures = z.infer<typeof PostFeaturesSchema>;
export type MarketFeatures = z.infer<typeof MarketFeaturesSchema>;
export type RecentSummary = z.infer<typeof RecentSummarySchema>;
export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;
export type CorrectionResponse = z.infer<typeof CorrectionResponseSchema>;
export type MetaParamsRequest = z.infer<typeof MetaParamsRequestSchema>;
export type MetaParamsResponse = z.infer<typeof MetaParamsResponseSchema>;
export type PostUsefulnessRequest = z.infer<typeof PostUsefulnessRequestSchema>;
export type PostUsefulnessResponse = z.infer<typeof PostUsefulnessResponseSchema>;
export type TrainingStatus = z.infer<typeof TrainingStatusSchema>;

// ============================================================================
// ML Integration Mode
// ============================================================================

export type MLMode = "disabled" | "correction" | "meta" | "shadow";

export interface MLConfig {
  mode: MLMode;
  serviceUrl: string;
  secret: string;
  timeout: number;
  fallbackToBaseline: boolean;
}

export const DEFAULT_ML_CONFIG: MLConfig = {
  mode: "disabled",
  serviceUrl: process.env.ML_SERVICE_URL || "http://localhost:8000",
  secret: process.env.INTERNAL_ML_SECRET || "",
  timeout: 5000,
  fallbackToBaseline: true,
};

