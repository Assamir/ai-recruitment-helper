import { describe, it, expect, vi } from "vitest";
import { createLLMModel } from "@/lib/llm/client";

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const model = createLLMModel({ provider: "unknown" as any, model: "test" });
    expect(model).toBeNull();
  });
});
