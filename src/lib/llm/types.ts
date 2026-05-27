import { z } from "zod/v4";

export type LLMProvider = "lmstudio" | "openrouter";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
}

export interface LLMTimingMetrics {
  total_ms: number;
  llm_latency_ms: number;
  parse_ms: number;
}

export const DEFAULT_PROVIDER: LLMProvider = "lmstudio";
export const DEFAULT_MODEL = "google/gemma-4-e4b";
export const DEFAULT_TIMEOUT_MS = 55_000;
export const LMSTUDIO_BASE_URL = "http://localhost:1234/v1";

export const HealthCheckResponseSchema = z.object({
  summary: z.string(),
  anomaly_count: z.number(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
