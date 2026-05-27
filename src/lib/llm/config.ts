import { OPENROUTER_API_KEY, LLM_PROVIDER, LLM_MODEL } from "astro:env/server";

import type { LLMConfig, LLMProvider } from "./types.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "./types.js";

const VALID_PROVIDERS: ReadonlySet<string> = new Set(["lmstudio", "openrouter"]);

export function getLLMConfig(): LLMConfig | null {
  const provider = (LLM_PROVIDER ?? DEFAULT_PROVIDER) as LLMProvider;

  if (!VALID_PROVIDERS.has(provider)) {
    return null;
  }

  if (provider === "openrouter" && !OPENROUTER_API_KEY) {
    return null;
  }

  return {
    provider,
    model: LLM_MODEL ?? DEFAULT_MODEL,
    apiKey: OPENROUTER_API_KEY ?? undefined,
  };
}
