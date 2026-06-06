import { vi } from "vitest";

vi.mock("astro:env/server", () => ({
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_KEY: "test-anon-key",
  LLM_PROVIDER: "lmstudio",
  LLM_MODEL: "test-model",
  OPENROUTER_API_KEY: undefined,
  LINKEDIN_SESSION_COOKIE: undefined,
}));
