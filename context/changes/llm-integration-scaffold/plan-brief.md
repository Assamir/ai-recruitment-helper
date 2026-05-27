# LLM Integration Scaffold — Plan Brief

> Full plan: `context/changes/llm-integration-scaffold/plan.md`

## What & Why

Wire the LLM foundation that the entire analysis pipeline depends on. The project has no AI/LLM integration today — this change installs the Vercel AI SDK with dual-provider support (LM Studio local + OpenRouter cloud), builds a typed service module with timeout and error handling, and verifies that the 60-second round-trip completes successfully on Cloudflare Workers. Without this scaffold, S-01 (the north-star end-to-end generation slice) cannot start.

## Starting Point

The codebase is an Astro 6 SSR app on Cloudflare Workers with Supabase auth. F-01 is complete — database tables (`analyses`, `analysis_questions`) are ready to receive LLM output, but no application code writes to them yet. There are no LLM dependencies, no JSON API routes, no test framework, and no external API calls anywhere in `src/`.

## Desired End State

A typed LLM client module at `src/lib/llm/` lets any API route call `completeLLM()` with a Zod schema and get back structured, validated data from either a local or cloud LLM. A viability test endpoint at `/api/llm/health` proves the round-trip works under 60 seconds on Workers. Vitest is configured with unit tests for the client module.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| LLM provider(s) | LM Studio (local) + OpenRouter (cloud), switchable via env var | Dual-provider gives local development speed and production cloud reliability — matches the shape-notes hybrid preference. | Plan |
| Client library | Vercel AI SDK (`ai` v6) with `@ai-sdk/openai-compatible` + `@openrouter/ai-sdk-provider` | Runtime-agnostic, supports both OpenAI-compatible endpoints natively, has built-in `generateObject` for structured JSON output. | Plan |
| Default models | google/gemma-4-e4b (LM Studio), GPT-4o (OpenRouter) | Gemma-4-e4b is lightweight for local dev; GPT-4o is the production reasoning model. | Plan |
| Provider switching | `LLM_PROVIDER` env var (`lmstudio` \| `openrouter`) | Simple, no code changes needed — same pattern as existing config-driven architecture. | Plan |
| Missing config behavior | Graceful null/error (like Supabase pattern) | Consistent with existing `createClient()` null pattern — app builds and runs without LLM config, just returns 503 on LLM endpoints. | Plan |
| Env vars | 3 vars: `OPENROUTER_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL` | Minimal surface — LM Studio URL defaults to `localhost:1234/v1`. | Plan |
| Error handling | Typed error classes, API route catches and returns JSON | Enables status-code mapping (502/503/504) and structured error responses for the first JSON API route. | Plan |
| Timeout | AbortController at 55s default | 5-second buffer under the 60s PRD requirement for routing overhead. | Plan |
| Response parsing | JSON mode + Zod v4 schema validation via `generateObject` | Type-safe responses with automatic validation — no manual parsing. | Plan |
| Viability test | Dedicated `/api/llm/health` endpoint with synthetic CV (~2000 words) | Reproducible, deployed, measures real wall-clock timing on Workers. | Plan |
| Logging | Structured JSON `console.log/error` | Visible via `wrangler tail`; no extra dependencies needed. | Plan |
| Testing | Vitest (standard, not Workers pool) with unit tests | First test framework in the project; tests pure TypeScript module without Workers runtime dependency. | Plan |
| Scope boundary | No analysis logic, no prompts, no DB writes | Clean separation — this scaffold owns LLM connectivity; S-01 owns the analysis pipeline. | Plan |

## Scope

**In scope:**
- AI SDK + provider packages installation
- 3 new env vars in Astro config + `.env.example`
- LLM client module (`src/lib/llm/`) with provider factory, service function, error types, Zod schema
- Viability test endpoint (`POST /api/llm/health`) with synthetic CV data and timing metrics
- Vitest setup with unit tests for schema validation, provider selection, error handling
- Workers viability verification (timing under 60s)

**Out of scope:**
- Analysis logic, prompt engineering, anomaly categories (S-01)
- DB writes to `analyses`/`analysis_questions` tables (S-01)
- File upload/parsing, PII anonymization (S-01)
- UI changes, streaming responses, Workers AI binding
- Integration tests via `@cloudflare/vitest-pool-workers`

## Architecture / Approach

```
astro:env/server → config.ts → LLMConfig
                                    ↓
                              client.ts
                            ┌───────┴───────┐
                     LM Studio          OpenRouter
                   (local:1234)      (openrouter.ai)
                            └───────┬───────┘
                              generateObject()
                                    ↓
                            Zod validation
                                    ↓
                        { data: T, timing }
```

The client module is provider-agnostic — config.ts reads env vars and passes a config object. client.ts creates the AI SDK model and wraps `generateObject` with timeout, error handling, and timing. API routes import from `@/lib/llm` and call `completeLLM()`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Dependencies & Environment | AI SDK, Zod, Vitest installed; env vars declared | Version conflicts between AI SDK v6 and Zod v4 |
| 2. LLM Client Module | Provider factory, service function, error types | AI SDK `generateObject` may behave differently on LM Studio vs OpenRouter |
| 3. Viability Test Route | First JSON API endpoint with synthetic CV and timing | Synthetic CV may not be representative of real workload timing |
| 4. Unit Tests | Vitest config + 12-18 test assertions | Mocking AI SDK correctly for timeout/error tests |
| 5. Verification & Docs | Workers timing confirmed, AGENTS.md updated | OpenRouter latency may vary; need multiple test runs |

**Prerequisites:** None (F-02 is parallel with F-01, which is already complete)
**Estimated effort:** ~2-3 focused sessions across 5 phases

## Open Risks & Assumptions

- **Workers wall-clock duration:** The 60s PRD requirement is wall-clock, not CPU. Workers paid plan has 30s CPU cap but no documented wall-clock limit for I/O-heavy requests. If the total request duration is capped below 60s, the architecture needs fundamental changes (Queues, deferred results).
- **LM Studio `generateObject` support:** Smaller local models may not reliably produce valid JSON in response to `generateObject`. The viability test will surface this — if it fails with LM Studio, we document it as a known limitation (OpenRouter is the production target).
- **Zod v4 compatibility:** Zod v4 is relatively new and may have edge cases with the AI SDK's schema integration. If validation issues arise, we can fall back to `generateText` with manual JSON parsing.

## Success Criteria (Summary)

- `POST /api/llm/health` returns structured timing metrics under 60 seconds when tested on Cloudflare Workers with OpenRouter + GPT-4o
- Provider switching works via env var — same endpoint, different provider, no code changes
- `npm run test` passes with all unit tests green
