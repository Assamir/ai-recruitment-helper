# LLM Integration Scaffold — Implementation Plan

## Overview

Scaffold the LLM integration layer (F-02): install the Vercel AI SDK with dual-provider support (LM Studio local + OpenRouter cloud), wire API key management through Cloudflare secrets, build a typed LLM service with configurable timeout and structured error handling, create a viability test endpoint with synthetic CV data that measures round-trip timing, add Vitest with unit tests for the client module, and verify that the 60-second round-trip completes successfully on Cloudflare Workers.

## Current State Analysis

The project has **no LLM integration**. The codebase is an Astro 6 SSR app deployed on Cloudflare Workers with Supabase auth. F-01 (data schema) is complete — the `analyses` table already models the pipeline stages and `analysis_questions` stores normalized LLM output, but no application code reads or writes these tables yet.

- No `fetch()` calls to external APIs exist anywhere in `src/`
- No JSON API routes exist — all three auth routes use `formData()` and return redirects
- No test framework is configured
- `package.json` has no AI/LLM-related dependencies
- `astro.config.mjs` declares only `SUPABASE_URL` and `SUPABASE_KEY`
- `.env.example` has only Supabase and Cloudflare credentials
- `wrangler.jsonc` has `nodejs_compat` enabled; no Workers AI binding

### Key Discoveries:

- `wrangler.jsonc` comment flags the need for the $5/mo paid Workers plan for the CV analysis pipeline (10ms CPU free tier is insufficient)
- `infrastructure.md` confirms LLM `fetch()` calls are I/O wait (not CPU) — the 30s CPU cap on paid Workers is not the bottleneck; total wall-clock request duration is the constraint
- Shape-notes prefer a hybrid approach: local model for anonymization + OpenRouter for reasoning. This scaffold wires the dual-provider foundation; S-01 decides the actual prompt pipeline
- The existing env var pattern uses `astro:env/server` imports with `optional: true` — the app builds without secrets but is non-functional at runtime
- Middleware populates `context.locals.user` on every request but only redirects (HTML) for protected routes — API routes need their own auth checks returning JSON 401

## Desired End State

After this plan is complete:

1. The Vercel AI SDK (`ai` v6) is installed with two provider packages: `@openrouter/ai-sdk-provider` for cloud and `@ai-sdk/openai-compatible` for LM Studio local
2. Three env vars are declared in `astro.config.mjs`: `OPENROUTER_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`
3. A typed LLM client module at `src/lib/llm/` provides a provider-agnostic interface — switching between LM Studio and OpenRouter requires only changing the `LLM_PROVIDER` env var
4. A viability test endpoint at `POST /api/llm/health` sends a synthetic CV-length prompt (~2000 words), receives a structured JSON response, and returns timing metrics
5. Vitest is configured with unit tests for schema validation, provider selection, and error handling
6. The 60-second Workers viability check is verified via `wrangler dev --remote` with documented timing results

Verification: `npm run build` passes; `npm run test` passes; the health endpoint returns timing data under 60s when tested against a live LLM provider; `npm run lint` passes.

## What We're NOT Doing

- **No analysis logic** — the actual CV analysis pipeline, prompt engineering, anomaly detection categories, and QA-specific prompting are S-01's responsibility
- **No DB writes** — no interaction with `analyses` or `analysis_questions` tables; the LLM client is a standalone service module
- **No file upload or parsing** — PDF/DOCX handling is S-01 scope
- **No PII anonymization** — anonymization layer is S-01 scope; the viability test uses synthetic data with no real PII
- **No UI changes** — no new pages, components, or dashboard modifications
- **No streaming responses** — MVP uses synchronous `generateObject` for simplicity; streaming can be added in S-01 if needed
- **No Cloudflare Workers AI binding** — explicitly out of scope per infrastructure decisions; using external providers via HTTP
- **No integration tests via `@cloudflare/vitest-pool-workers`** — unit tests with standard Vitest are sufficient for the client module; Workers-runtime integration tests can be added in later slices

## Implementation Approach

Build a provider-agnostic LLM client module that decouples configuration (env vars) from the service logic (provider factory, structured generation, error handling). The module accepts a config object — making it testable without the Astro runtime. A thin config layer reads `astro:env/server` vars and passes them to the client. The viability test endpoint is the first JSON API route in the app, establishing the pattern for all future domain endpoints (JSON request/response, auth via `context.locals.user`, structured error responses).

## Phase 1: Dependencies & Environment Configuration

### Overview

Install the AI SDK packages, Zod for schema validation, and Vitest for testing. Declare the three LLM env vars in Astro's env schema. Update `.env.example`. Create the Vitest config.

### Changes Required:

#### 1. Install production dependencies

**File**: `package.json`

**Intent**: Add the Vercel AI SDK core, both provider packages (OpenRouter + LM Studio), and Zod v4 for structured output validation.

**Contract**: New dependencies — `ai` (v6+), `@openrouter/ai-sdk-provider` (v2+), `@ai-sdk/openai-compatible`, `zod` (v4+). These are production dependencies because the LLM client runs at request time on Workers.

#### 2. Install dev dependencies and add test script

**File**: `package.json`

**Intent**: Add Vitest as a dev dependency and wire a `test` script.

**Contract**: Add `vitest` (v4+) to `devDependencies`. Add `"test": "vitest run"` and `"test:watch": "vitest"` to `scripts`.

#### 3. Declare LLM env vars in Astro config

**File**: `astro.config.mjs`

**Intent**: Register the three LLM env vars in Astro's type-safe env schema so they're importable from `astro:env/server`. All optional so the build passes without them (same pattern as Supabase vars).

**Contract**: Add to `env.schema`:
- `OPENROUTER_API_KEY` — `envField.string({ context: "server", access: "secret", optional: true })`
- `LLM_PROVIDER` — `envField.string({ context: "server", access: "secret", optional: true })`
- `LLM_MODEL` — `envField.string({ context: "server", access: "secret", optional: true })`

#### 4. Update env example

**File**: `.env.example`

**Intent**: Document the new env vars with placeholder values so developers know what to configure.

**Contract**: Add `OPENROUTER_API_KEY=###`, `LLM_PROVIDER=lmstudio`, `LLM_MODEL=google/gemma-4-e4b`.

#### 5. Create Vitest configuration

**File**: `vitest.config.ts` (new, at project root)

**Intent**: Configure Vitest with the `@/*` path alias matching tsconfig so test imports resolve correctly.

**Contract**: Standard Vitest config using `resolve.alias` to map `@` to `./src`. No Workers pool — standard Node.js runtime is sufficient for unit testing the pure TypeScript LLM client module.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `npm install`
- Astro sync succeeds: `npx astro sync`
- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Vitest runs (no tests yet, exits 0): `npm run test`

#### Manual Verification:

- `astro:env/server` exports all 5 env vars (2 Supabase + 3 LLM) without type errors in IDE
- `.env.example` documents all env vars

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: LLM Client Module

### Overview

Build the typed LLM client module at `src/lib/llm/` — a provider factory that switches between LM Studio and OpenRouter, a service function that wraps `generateObject` with AbortController timeout and structured logging, error types, Zod schemas, and a config reader for Astro env vars.

### Changes Required:

#### 1. Type definitions and Zod schemas

**File**: `src/lib/llm/types.ts` (new)

**Intent**: Define the TypeScript types for LLM configuration, provider selection, and response validation. Includes a Zod schema for the viability test response (simple structured output to prove JSON mode works). The schema used in this scaffold is intentionally minimal — S-01 will define the full analysis response schema.

**Contract**:
- `LLMProvider` type: `'lmstudio' | 'openrouter'`
- `LLMConfig` interface: `{ provider: LLMProvider; model: string; apiKey?: string }`
- `LLMTimingMetrics` interface: `{ total_ms: number; llm_latency_ms: number; parse_ms: number }`
- `HealthCheckResponse` Zod schema: a simple object with `summary` (string) and `anomaly_count` (number) — enough to verify structured output parsing without being a real analysis schema
- Defaults: `DEFAULT_PROVIDER = 'lmstudio'`, `DEFAULT_MODEL = 'google/gemma-4-e4b'`, `DEFAULT_TIMEOUT_MS = 55_000`, `LMSTUDIO_BASE_URL = 'http://localhost:1234/v1'`

#### 2. Error classes

**File**: `src/lib/llm/errors.ts` (new)

**Intent**: Typed error classes that the API route can catch and map to specific HTTP status codes. Separates LLM-specific failures from generic errors.

**Contract**:
- `LLMError` (base): extends `Error`, adds `code` string field
- `LLMConfigError`: missing or invalid configuration (→ 503)
- `LLMConnectionError`: network failure or provider unreachable (→ 502)
- `LLMTimeoutError`: AbortController triggered (→ 504)
- `LLMParseError`: response didn't match Zod schema (→ 502)

#### 3. Provider factory and service function

**File**: `src/lib/llm/client.ts` (new)

**Intent**: The core of the scaffold. A `createLLMModel()` factory that returns the correct AI SDK model instance based on config, and a `completeLLM()` service function that wraps `generateObject` with timeout, error handling, timing measurement, and structured console logging.

**Contract**:
- `createLLMModel(config: LLMConfig)` → returns an AI SDK `LanguageModel` instance. For `'openrouter'` provider, uses `createOpenRouter({ apiKey })`. For `'lmstudio'`, uses `createOpenAICompatible({ name: 'lmstudio', baseURL: LMSTUDIO_BASE_URL })`. Returns `null` if the OpenRouter provider is selected but no API key is provided (graceful null pattern matching Supabase client).
- `completeLLM<T>(options: { model, schema, prompt, systemPrompt?, timeoutMs? })` → wraps `generateObject()` from the AI SDK with:
  - AbortController with configurable timeout (default 55s)
  - Timing measurement (LLM latency + parse time)
  - Structured `console.log` on success (provider, model, timing) and `console.error` on failure (error class, message)
  - Catches AI SDK errors and wraps them in the typed error hierarchy
  - Returns `{ data: T; timing: LLMTimingMetrics }`

#### 4. Astro env config reader

**File**: `src/lib/llm/config.ts` (new)

**Intent**: Thin bridge between Astro's `astro:env/server` imports and the provider-agnostic `LLMConfig` interface. This is the only file in the LLM module that depends on the Astro runtime — everything else is pure TypeScript and testable without Astro.

**Contract**: Exports `getLLMConfig(): LLMConfig | null`. Reads `OPENROUTER_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL` from `astro:env/server`. Returns `null` if the selected provider requires credentials that are missing (OpenRouter without API key). Falls back to defaults for `LLM_PROVIDER` and `LLM_MODEL` when not set.

#### 5. Barrel export

**File**: `src/lib/llm/index.ts` (new)

**Intent**: Re-export public API from the module.

**Contract**: Exports from `types.ts`, `errors.ts`, `client.ts`, and `config.ts`.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build` (with `npx astro sync` first)
- Lint passes: `npm run lint`
- TypeScript compiles without errors (checked by build)

#### Manual Verification:

- IDE shows correct type inference on `createLLMModel()` return type
- IDE shows correct type inference on `completeLLM()` generic parameter
- Importing from `@/lib/llm` resolves all exports without errors

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Viability Test API Route

### Overview

Create the first JSON API route in the app — a `POST /api/llm/health` endpoint that sends a synthetic CV-length prompt through the LLM client, measures the round-trip timing, and returns structured metrics. This proves end-to-end connectivity and validates whether the 60-second Workers execution window is feasible.

### Changes Required:

#### 1. Synthetic test data

**File**: `src/lib/llm/test-data.ts` (new)

**Intent**: Hardcoded synthetic QA CV text (~2000 words) and a QA job profile summary for the viability test. Contains intentional anomalies (timeline contradictions, vague claims) to make the prompt representative of a real analysis workload without using real PII.

**Contract**: Exports `SYNTHETIC_CV_TEXT` (string, ~2000 words — a fake QA engineer CV with deliberate anomalies) and `SYNTHETIC_JOB_PROFILE` (string — a brief QA automation engineer job description). These are constants, not templates — the test always sends the same payload for reproducible benchmarking.

#### 2. Health check API route

**File**: `src/pages/api/llm/health.ts` (new)

**Intent**: The viability test endpoint. Accepts a POST request from an authenticated user, creates the LLM model from config, sends the synthetic CV as a structured generation prompt, measures timing at each stage, and returns JSON metrics. This is the first JSON API route — it establishes the pattern for returning `new Response(JSON.stringify(...))` with appropriate status codes and Content-Type headers.

**Contract**:
- Method: `POST` only
- Auth: Checks `context.locals.user`; returns 401 JSON if not authenticated
- Config: Calls `getLLMConfig()`; returns 503 JSON if LLM not configured
- Model: Calls `createLLMModel(config)`; returns 503 if model creation fails
- Generation: Calls `completeLLM()` with the synthetic CV text, `HealthCheckResponse` schema, and a simple prompt asking the model to summarize the CV and count anomalies
- Success response (200): `{ status: 'ok', provider, model, timing: { total_ms, llm_latency_ms, parse_ms }, response_preview: string }`
- Error responses: 401 (not authenticated), 502 (LLM connection/parse error), 503 (not configured), 504 (timeout)
- Each error response includes `{ error: string, code: string }` JSON body

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- With LM Studio running locally: `curl -X POST http://localhost:4321/api/llm/health` (with auth cookie) returns 200 with timing metrics
- Without LM Studio: endpoint returns 502 with a connection error (not a crash)
- Without auth: endpoint returns 401 JSON (not a redirect)
- Without LLM env vars: endpoint returns 503 with a configuration error
- Response `timing.total_ms` is logged to console (visible via `wrangler tail` in production)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Unit Tests

### Overview

Configure Vitest and write unit tests for the LLM client module — Zod schema validation, provider factory logic, error class behavior, and timeout handling. Tests mock the AI SDK to avoid real LLM calls.

### Changes Required:

#### 1. Schema validation tests

**File**: `tests/lib/llm/types.test.ts` (new)

**Intent**: Verify that the Zod `HealthCheckResponse` schema correctly validates well-formed responses and rejects malformed ones. This proves the parse layer works independently of the LLM.

**Contract**: Test cases:
- Valid response object passes validation
- Missing required fields are rejected with specific error messages
- Extra fields are stripped (Zod default behavior)
- Wrong field types are rejected (e.g., string where number expected)

#### 2. Client module tests

**File**: `tests/lib/llm/client.test.ts` (new)

**Intent**: Verify that the provider factory selects the correct AI SDK provider based on config, handles missing credentials gracefully, and that the service function wraps errors correctly.

**Contract**: Test cases:
- `createLLMModel({ provider: 'openrouter', model: 'gpt-4o', apiKey: 'key' })` returns a model instance (mock the provider)
- `createLLMModel({ provider: 'openrouter', model: 'gpt-4o' })` without `apiKey` returns `null`
- `createLLMModel({ provider: 'lmstudio', model: 'gemma' })` returns a model instance without requiring an API key
- `completeLLM()` wraps AI SDK `APICallError` into `LLMConnectionError`
- `completeLLM()` wraps AbortController abort into `LLMTimeoutError`
- `completeLLM()` wraps Zod validation failure into `LLMParseError`
- `completeLLM()` returns timing metrics on success

#### 3. Error class tests

**File**: `tests/lib/llm/errors.test.ts` (new)

**Intent**: Verify error class hierarchy and properties.

**Contract**: Test cases:
- Each error class extends `LLMError`
- Each error has the expected `code` value
- `instanceof` checks work for the typed catch pattern

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm run test`
- No lint errors in test files: `npm run lint`

#### Manual Verification:

- Test output shows meaningful test names and clear pass/fail
- Test count matches expectations (12-18 individual assertions)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Workers Viability Verification & Documentation

### Overview

Deploy to Cloudflare Workers, run the viability test endpoint against a live LLM provider, record timing results, and update project documentation.

### Changes Required:

#### 1. Set OpenRouter secret on Workers

**Intent**: Configure the OpenRouter API key as a Cloudflare Worker runtime secret for the deployed viability test.

**Contract**: Run `npx wrangler secret put OPENROUTER_API_KEY` (interactive — paste the key). Also set `LLM_PROVIDER=openrouter` and `LLM_MODEL=openai/gpt-4o` as Worker secrets for the production viability test.

#### 2. Viability test on Workers

**Intent**: Run the health endpoint against the deployed Worker to measure real-world timing on the Cloudflare edge. This is the primary F-02 deliverable — confirming the 60-second round-trip is feasible.

**Contract**: Use `wrangler dev --remote` or the deployed preview URL. POST to `/api/llm/health` with a valid auth session. Record the timing metrics. The viability check passes if `timing.total_ms < 60000`.

#### 3. Update change.md

**File**: `context/changes/llm-integration-scaffold/change.md`

**Intent**: Mark the change as planned.

**Contract**: Set `status: planned`, update `updated:` to today's date.

#### 4. Update .env.example documentation

**File**: `.env.example`

**Intent**: Already updated in Phase 1, but verify the final env var set is documented with clear comments.

**Contract**: The file should list all 7 env vars (2 Supabase + 2 Cloudflare + 3 LLM) with descriptive comments.

#### 5. Update AGENTS.md

**File**: `AGENTS.md`

**Intent**: Document the LLM integration for future agents working in this repo.

**Contract**: Add a brief section about the LLM module — where it lives, how to configure providers, and the test endpoint. Mention the env vars.

### Success Criteria:

#### Automated Verification:

- Full build passes: `npx astro sync && npm run build`
- All tests pass: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- `POST /api/llm/health` on `wrangler dev --remote` returns 200 with timing under 60s using OpenRouter + GPT-4o
- `POST /api/llm/health` on local `npm run dev` returns 200 using LM Studio + gemma (when LM Studio is running)
- Console logs are visible via `wrangler tail` with structured JSON format
- AGENTS.md accurately documents the new LLM module

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Zod schema validation: correct accept/reject behavior for `HealthCheckResponse`
- Provider factory: correct provider selection, graceful null on missing credentials
- Error classes: hierarchy, `code` field, `instanceof` checks
- Service function: timeout wrapping, error translation, timing metric calculation (AI SDK calls mocked)

### Integration Tests:

Not in scope for F-02. S-01 will be the first slice that exercises the full analysis pipeline through the LLM client with real DB writes.

### Manual Testing Steps:

1. Start LM Studio with `google/gemma-4-e4b` loaded
2. Set `LLM_PROVIDER=lmstudio` in `.env`
3. Run `npm run dev` and POST to `/api/llm/health` (via curl or browser dev tools with auth cookie)
4. Verify: response includes timing metrics, status 200
5. Stop LM Studio, POST again — verify: 502 error response with `LLMConnectionError` code
6. Set `LLM_PROVIDER=openrouter`, `LLM_MODEL=openai/gpt-4o`, and `OPENROUTER_API_KEY` in `.env`
7. POST to `/api/llm/health` — verify: response includes timing metrics from OpenRouter
8. Remove `OPENROUTER_API_KEY` from `.env`, POST again — verify: 503 error response
9. Deploy to Workers with `wrangler dev --remote`, set secrets, POST — verify: timing under 60s

## Performance Considerations

- The 55-second AbortController timeout leaves a 5-second buffer under the 60-second PRD requirement — enough for request routing overhead and response serialization
- LLM `fetch()` calls are I/O wait on Workers (not CPU time) — the 30s CPU cap on the paid plan is not the bottleneck for API calls
- CPU-heavy work in this scaffold is minimal (JSON parsing, Zod validation) — well under 10ms CPU even on the free tier
- The viability test measures wall-clock time end-to-end, which is the metric that matters for the PRD requirement
- Structured console.log uses JSON format for efficient parsing by `wrangler tail` and Cloudflare observability

## Migration Notes

- This is the first LLM dependency in the project — no migration from an existing setup
- `LLM_PROVIDER` defaults to `'lmstudio'` — existing deployments without the env var will attempt local LM Studio (and gracefully fail if it's not running)
- OpenRouter API key must be set via `npx wrangler secret put OPENROUTER_API_KEY` for production
- Adding Vitest does not affect the existing build or deploy pipeline — tests are a dev-only concern
- No existing tests to break — this is the first test setup

## References

- Roadmap F-02: `context/foundation/roadmap.md` — LLM integration scaffold definition
- PRD NFR: `context/foundation/prd.md` — 60-second response requirement
- Infrastructure: `context/foundation/infrastructure.md` — Workers constraints, secrets pattern
- Shape-notes: `context/foundation/shape-notes.md` — hybrid LLM approach preference
- F-01 plan: `context/changes/data-schema-and-rls/plan.md` — schema contract for `analyses` and `analysis_questions` tables
- Vercel AI SDK docs: `https://ai-sdk.dev/providers/openai-compatible-providers/lmstudio`
- OpenRouter AI SDK provider: `https://github.com/OpenRouterTeam/ai-sdk-provider`
- Cloudflare Vitest integration: `https://developers.cloudflare.com/workers/testing/vitest-integration/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dependencies & Environment Configuration

#### Automated

- [x] 1.1 Dependencies install cleanly — 2568248
- [x] 1.2 Astro sync succeeds — 2568248
- [x] 1.3 Build passes — 2568248
- [x] 1.4 Lint passes — 2568248
- [x] 1.5 Vitest runs (exits 0) — 2568248

#### Manual

- [x] 1.6 astro:env/server exports all 5 env vars without type errors — 2568248
- [x] 1.7 .env.example documents all env vars — 2568248

### Phase 2: LLM Client Module

#### Automated

- [x] 2.1 Build passes — e878931
- [x] 2.2 Lint passes — e878931

#### Manual

- [x] 2.3 IDE shows correct type inference on createLLMModel — e878931
- [x] 2.4 IDE shows correct type inference on completeLLM — e878931
- [x] 2.5 Imports from @/lib/llm resolve all exports — e878931

### Phase 3: Viability Test API Route

#### Automated

- [x] 3.1 Build passes — 49c1e09
- [x] 3.2 Lint passes — 49c1e09

#### Manual

- [x] 3.3 LM Studio running: health endpoint returns 200 with timing — b3d8d11
- [ ] 3.4 LM Studio stopped: health endpoint returns 502
- [ ] 3.5 No auth: health endpoint returns 401 JSON
- [ ] 3.6 No LLM config: health endpoint returns 503

### Phase 4: Unit Tests

#### Automated

- [x] 4.1 All tests pass — 18365d7
- [x] 4.2 No lint errors in test files — 18365d7

#### Manual

- [x] 4.3 Test output shows meaningful names and pass/fail — 18365d7
- [x] 4.4 Test count matches expectations (12-18 assertions) — 18365d7

### Phase 5: Workers Viability Verification & Documentation

#### Automated

- [x] 5.1 Full build passes — b3d8d11
- [x] 5.2 All tests pass — b3d8d11
- [x] 5.3 Lint passes — b3d8d11

#### Manual

- [ ] 5.4 Health endpoint on wrangler dev --remote returns timing under 60s
- [ ] 5.5 Health endpoint on local dev returns 200 with LM Studio
- [ ] 5.6 Console logs visible via wrangler tail
- [x] 5.7 AGENTS.md documents the LLM module — b3d8d11
