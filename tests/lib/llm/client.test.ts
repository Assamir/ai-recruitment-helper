/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLLMModel, completeLLM } from "@/lib/llm/client";
import { HealthCheckResponseSchema } from "@/lib/llm/types";
import { LLMConnectionError, LLMTimeoutError, LLMParseError } from "@/lib/llm/errors";

const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: { object: vi.fn(({ schema }: { schema: unknown }) => ({ schema })) },
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(({ apiKey }: { apiKey: string }) => {
    return (model: string) => ({
      provider: "openrouter",
      modelId: model,
      specificationVersion: "v1",
      _apiKey: apiKey,
    });
  }),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(({ name, baseURL }: { name: string; baseURL: string }) => {
    return (model: string) => ({
      provider: name,
      modelId: model,
      specificationVersion: "v1",
      _baseURL: baseURL,
    });
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeModel = { provider: "lmstudio", modelId: "test-model" } as any;

describe("createLLMModel", () => {
  it("returns a model for openrouter provider with API key", () => {
    const model = createLLMModel({ provider: "openrouter", model: "openai/gpt-4o", apiKey: "test-key" });
    expect(model).not.toBeNull();
    expect(model).toHaveProperty("provider", "openrouter");
    expect(model).toHaveProperty("modelId", "openai/gpt-4o");
  });

  it("returns null for openrouter without API key", () => {
    const model = createLLMModel({ provider: "openrouter", model: "openai/gpt-4o" });
    expect(model).toBeNull();
  });

  it("returns a model for lmstudio without API key", () => {
    const model = createLLMModel({ provider: "lmstudio", model: "google/gemma-4-e4b" });
    expect(model).not.toBeNull();
    expect(model).toHaveProperty("provider", "lmstudio");
    expect(model).toHaveProperty("modelId", "google/gemma-4-e4b");
  });

  it("returns null for unknown provider", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = createLLMModel({ provider: "unknown" as any, model: "test" });
    expect(model).toBeNull();
  });
});

describe("completeLLM", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("returns data and timing on successful text extraction", async () => {
    mockGenerateText.mockResolvedValue({
      text: '{"summary": "Good candidate", "anomaly_count": 2}',
    });

    const result = await completeLLM({
      model: fakeModel,
      schema: HealthCheckResponseSchema,
      prompt: "Analyze this CV",
    });

    expect(result.data).toEqual({ summary: "Good candidate", anomaly_count: 2 });
    expect(result.timing).toHaveProperty("total_ms");
    expect(result.timing).toHaveProperty("llm_latency_ms");
    expect(result.timing).toHaveProperty("parse_ms");
    expect(result.timing.total_ms).toBeGreaterThanOrEqual(0);
  });

  it("extracts JSON from markdown fenced blocks", async () => {
    mockGenerateText.mockResolvedValue({
      text: '```json\n{"summary": "Fenced response", "anomaly_count": 0}\n```',
    });

    const result = await completeLLM({
      model: fakeModel,
      schema: HealthCheckResponseSchema,
      prompt: "Analyze this CV",
    });

    expect(result.data).toEqual({ summary: "Fenced response", anomaly_count: 0 });
  });

  it("throws LLMParseError when response does not match schema", async () => {
    mockGenerateText.mockResolvedValue({
      text: '{"wrong_field": "value"}',
    });

    await expect(
      completeLLM({
        model: fakeModel,
        schema: HealthCheckResponseSchema,
        prompt: "Analyze this CV",
      }),
    ).rejects.toThrow(LLMParseError);
  });

  it("throws LLMParseError on invalid JSON (SyntaxError)", async () => {
    mockGenerateText.mockResolvedValue({
      text: "This is not JSON at all",
    });

    await expect(
      completeLLM({
        model: fakeModel,
        schema: HealthCheckResponseSchema,
        prompt: "Analyze this CV",
      }),
    ).rejects.toThrow(LLMParseError);
  });

  it("throws LLMTimeoutError when AbortController fires", async () => {
    mockGenerateText.mockImplementation(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });

    await expect(
      completeLLM({
        model: fakeModel,
        schema: HealthCheckResponseSchema,
        prompt: "Analyze this CV",
        timeoutMs: 100,
      }),
    ).rejects.toThrow(LLMTimeoutError);
  });

  it("throws LLMConnectionError on network failures", async () => {
    mockGenerateText.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await expect(
      completeLLM({
        model: fakeModel,
        schema: HealthCheckResponseSchema,
        prompt: "Analyze this CV",
      }),
    ).rejects.toThrow(LLMConnectionError);
  });

  it("throws LLMParseError when structured output returns null", async () => {
    mockGenerateText.mockResolvedValue({ output: null });

    await expect(
      completeLLM({
        model: fakeModel,
        schema: HealthCheckResponseSchema,
        prompt: "Analyze this CV",
        useStructuredOutput: true,
      }),
    ).rejects.toThrow(LLMParseError);
  });
});
