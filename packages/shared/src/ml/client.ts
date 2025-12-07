/**
 * ML Service Client
 * TypeScript client for calling the ML feedback loop service
 */

import {
  CorrectionRequest,
  CorrectionResponse,
  CorrectionResponseSchema,
  MetaParamsRequest,
  MetaParamsResponse,
  MetaParamsResponseSchema,
  PostUsefulnessRequest,
  PostUsefulnessResponse,
  PostUsefulnessResponseSchema,
  TrainingStatus,
  TrainingStatusSchema,
  MLConfig,
  DEFAULT_ML_CONFIG,
} from "./types";

export class MLClient {
  private config: MLConfig;

  constructor(config: Partial<MLConfig> = {}) {
    this.config = { ...DEFAULT_ML_CONFIG, ...config };
  }

  private async fetch<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: unknown
  ): Promise<T | null> {
    if (this.config.mode === "disabled") {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.serviceUrl}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": this.config.secret,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`ML service error: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === "AbortError") {
        console.error("ML service request timed out");
      } else {
        console.error("ML service request failed:", error);
      }
      
      return null;
    }
  }

  /**
   * Check if ML service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.fetch<{ status: string }>("/healthz");
      return result?.status === "healthy";
    } catch {
      return false;
    }
  }

  /**
   * Get training status and available models
   */
  async getStatus(): Promise<TrainingStatus | null> {
    const result = await this.fetch<TrainingStatus>("/status");
    if (!result) return null;

    try {
      return TrainingStatusSchema.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * Get probability corrections from ML model
   */
  async predictCorrection(request: CorrectionRequest): Promise<CorrectionResponse | null> {
    if (this.config.mode !== "correction" && this.config.mode !== "shadow") {
      return null;
    }

    const result = await this.fetch<CorrectionResponse>(
      "/v1/predict/correction",
      "POST",
      request
    );

    if (!result) return null;

    try {
      return CorrectionResponseSchema.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * Get suggested hyperparameters for a market
   */
  async predictMeta(request: MetaParamsRequest): Promise<MetaParamsResponse | null> {
    if (this.config.mode !== "meta") {
      return null;
    }

    const result = await this.fetch<MetaParamsResponse>(
      "/v1/predict/meta",
      "POST",
      request
    );

    if (!result) return null;

    try {
      return MetaParamsResponseSchema.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * Predict post usefulness
   */
  async predictPostUsefulness(
    request: PostUsefulnessRequest
  ): Promise<PostUsefulnessResponse | null> {
    const result = await this.fetch<PostUsefulnessResponse>(
      "/v1/predict/post_usefulness",
      "POST",
      request
    );

    if (!result) return null;

    try {
      return PostUsefulnessResponseSchema.parse(result);
    } catch {
      return null;
    }
  }
}

// Singleton instance
let mlClient: MLClient | null = null;

export function getMLClient(config?: Partial<MLConfig>): MLClient {
  if (!mlClient || config) {
    mlClient = new MLClient(config);
  }
  return mlClient;
}

