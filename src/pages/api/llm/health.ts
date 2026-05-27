import type { APIRoute } from "astro";
import { getLLMConfig, createLLMModel, completeLLM, HealthCheckResponseSchema } from "@/lib/llm";
import { LLMConnectionError, LLMTimeoutError, LLMParseError } from "@/lib/llm";
import { SYNTHETIC_CV_TEXT, SYNTHETIC_JOB_PROFILE } from "@/lib/llm/test-data";

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
  }

  const config = getLLMConfig();
  if (!config) {
    return jsonResponse({ error: "LLM provider is not configured", code: "LLM_CONFIG_ERROR" }, 503);
  }

  const model = createLLMModel(config);
  if (!model) {
    return jsonResponse({ error: "Failed to create LLM model", code: "LLM_CONFIG_ERROR" }, 503);
  }

  try {
    const { data, timing } = await completeLLM({
      model,
      schema: HealthCheckResponseSchema,
      systemPrompt:
        'You are a QA recruitment analyst. You ALWAYS respond with a JSON object and nothing else. The JSON must have exactly two fields: "summary" (a string with a brief analysis) and "anomaly_count" (a number counting anomalies like timeline contradictions, vague claims, missing skills, or red flags).',
      prompt: `Analyze this CV against the job profile. Respond with JSON only: {"summary": "...", "anomaly_count": N}\n\nCV:\n${SYNTHETIC_CV_TEXT}\n\nJob Profile:\n${SYNTHETIC_JOB_PROFILE}`,
    });

    return jsonResponse(
      {
        status: "ok",
        provider: config.provider,
        model: config.model,
        timing,
        response_preview: data.summary.substring(0, 200),
        anomaly_count: data.anomaly_count,
      },
      200,
    );
  } catch (error: unknown) {
    if (error instanceof LLMTimeoutError) {
      return jsonResponse({ error: error.message, code: error.code }, 504);
    }
    if (error instanceof LLMParseError) {
      return jsonResponse({ error: error.message, code: error.code }, 502);
    }
    if (error instanceof LLMConnectionError) {
      return jsonResponse({ error: error.message, code: error.code }, 502);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error", code: "UNKNOWN_ERROR" },
      500,
    );
  }
};
