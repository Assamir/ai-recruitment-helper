import type { LanguageModel } from "ai";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod/v4";

import type { LLMConfig, LLMTimingMetrics } from "./types.js";
import { DEFAULT_TIMEOUT_MS, LMSTUDIO_BASE_URL } from "./types.js";
import { LLMConnectionError, LLMTimeoutError, LLMParseError } from "./errors.js";

export function createLLMModel(config: LLMConfig): LanguageModel | null {
  switch (config.provider) {
    case "openrouter": {
      if (!config.apiKey) return null;
      const openrouter = createOpenRouter({ apiKey: config.apiKey });
      return openrouter(config.model);
    }
    case "lmstudio": {
      const lmstudio = createOpenAICompatible({
        name: "lmstudio",
        baseURL: LMSTUDIO_BASE_URL,
      });
      return lmstudio(config.model);
    }
    default:
      return null;
  }
}

interface CompleteLLMOptions<T extends z.ZodType> {
  model: LanguageModel;
  schema: T;
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  useStructuredOutput?: boolean;
}

interface CompleteLLMResult<T> {
  data: T;
  timing: LLMTimingMetrics;
}

function extractJSON(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) return JSON.parse(fenced[1].trim()) as unknown;

  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return JSON.parse(text.slice(braceStart, braceEnd + 1)) as unknown;
  }

  return JSON.parse(text) as unknown;
}

export async function completeLLM<T extends z.ZodType>(
  options: CompleteLLMOptions<T>,
): Promise<CompleteLLMResult<z.infer<T>>> {
  const { model, schema, prompt, systemPrompt, timeoutMs = DEFAULT_TIMEOUT_MS, useStructuredOutput = false } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const totalStart = performance.now();

  try {
    const llmStart = performance.now();

    let data: z.infer<T>;

    if (useStructuredOutput) {
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        prompt,
        system: systemPrompt,
        abortSignal: controller.signal,
      });
      data = result.output as z.infer<T>;
    } else {
      const jsonPrompt = `${prompt}\n\nRespond ONLY with a valid JSON object. No markdown, no explanation.`;
      const result = await generateText({
        model,
        prompt: jsonPrompt,
        system: systemPrompt,
        abortSignal: controller.signal,
      });

      const raw = extractJSON(result.text);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new LLMParseError(`Response JSON does not match schema: ${JSON.stringify(parsed.error)}`);
      }
      data = parsed.data;
    }

    const llmEnd = performance.now();
    const parseEnd = performance.now();

    const timing: LLMTimingMetrics = {
      total_ms: Math.round(parseEnd - totalStart),
      llm_latency_ms: Math.round(llmEnd - llmStart),
      parse_ms: Math.round(parseEnd - llmEnd),
    };

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "llm_completion",
        status: "ok",
        provider: String(model.provider),
        modelId: String(model.modelId),
        timing,
      }),
    );

    return { data, timing };
  } catch (error: unknown) {
    if (error instanceof LLMParseError) throw error;

    const totalEnd = performance.now();
    const elapsed = Math.round(totalEnd - totalStart);
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof Error && error.name === "AbortError") {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ event: "llm_completion", status: "timeout", elapsed_ms: elapsed }));
      throw new LLMTimeoutError(`LLM request timed out after ${timeoutMs}ms`);
    }

    if (error instanceof Error && error.message.includes("JSON")) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({ event: "llm_completion", status: "parse_error", elapsed_ms: elapsed, error: message }),
      );
      throw new LLMParseError(`Failed to parse LLM response as structured JSON: ${message}`);
    }

    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: "llm_completion",
        status: "connection_error",
        elapsed_ms: elapsed,
        error: message,
      }),
    );
    throw new LLMConnectionError(`LLM provider unreachable or returned an error: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
