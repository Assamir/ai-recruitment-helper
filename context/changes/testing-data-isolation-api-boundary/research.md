---
date: 2026-06-04T16:25:00+02:00
researcher: dczaj
git_commit: 5a23b0fb09c5a4a7633ca85a17779fdb837c2c4b
branch: main
repository: ai-recruitment-helper
topic: "Data isolation & API boundary — where ownership and input validation are (and aren't) enforced on API routes (Risks #4, #7)"
tags: [research, codebase, api, data-isolation, rls, idor, input-validation, testing, phase-3]
status: complete
last_updated: 2026-06-04
last_updated_by: dczaj
---

# Research: Data isolation & API boundary (Risks #4, #7)

**Date**: 2026-06-04T16:25:00+02:00
**Researcher**: dczaj
**Git Commit**: 5a23b0fb09c5a4a7633ca85a17779fdb837c2c4b
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

Phase 3 of the phased test rollout (`context/foundation/test-plan.md` §3). Ground the two
failure scenarios this phase must protect against, so integration tests can be written against
the API routes:

- **Risk #4 — IDOR / RLS gap.** Recruiter A reaches Recruiter B's analysis via the API. A
  request for another user's analysis id must return 403/404, not their data. Where is
  ownership enforced (route handler vs RLS), and what status does a denied cross-user read
  return today?
- **Risk #7 — Unvalidated input.** API routes accept oversized files, wrong types, or malformed
  bodies. Where does server-side validation live, what does it cover, and where are the gaps?

Test type for this phase: **integration on API routes** — mock only the external HTTP edge,
never internal modules (`change.md`, `test-plan.md` §6.2).

## Summary

**Risk #4 (data isolation):** Ownership of analysis records is enforced **primarily at the
Supabase RLS layer** (`auth.uid() = user_id` on `analyses`, `candidates`, and indirectly on
`analysis_questions`), **not** in most route-handler read queries.

- `GET /api/analysis/:id` and `GET /api/analysis/:id/status` filter by `.eq("id", id)` only —
  **no `.eq("user_id", …)`**. Cross-user denial depends entirely on RLS returning zero rows,
  which the handler maps to **404 `NOT_FOUND`**.
- `DELETE /api/analysis/:id` and the `POST /api/analysis` retry path are **defense-in-depth**:
  explicit `.eq("user_id", userId)` **plus** RLS. Inserts set `user_id` from the session.
- **No handler ever returns 403.** Not-found and not-owned are intentionally collapsed to 404
  (comment at `src/pages/api/analysis/[id]/index.ts:82-83`). Phase 3 tests must assert **404**,
  not 403.
- **The app uses the Supabase anon key over `@supabase/ssr` with session cookies**, so PostgREST
  runs as the logged-in user and RLS applies. The single biggest IDOR risk is a
  **misconfigured `SUPABASE_KEY` set to the `service_role` key**, which bypasses RLS entirely.

**Critical testing tension (read before writing any test):** Because reads rely on RLS — not an
app-level `user_id` filter — an integration test that **mocks `@/lib/supabase`** (the only
existing precedent, `tests/lib/api/analysis-retry-garbage.test.ts`) **cannot exercise RLS** and
will **false-pass** the IDOR check. The mock returns whatever it's told regardless of `user_id`.
Proving Risk #4 requires either (a) a real Supabase instance with two real user sessions (JWT
cookies) so RLS is live, or (b) a mock Supabase client that itself enforces `user_id` ownership.
Option (a) conflicts with CI today (no Supabase env on the test step). This is the key design
decision for the plan.

**Risk #7 (input validation):** Only `POST /api/analysis` has substantive server-side
validation (multipart parse guarded by try/catch, required `job_profile_id`, CV-source rules,
MIME-based extractor dispatch, and the `assertUsableCvText` quality gate). There is **no central
error handler**, **no server-side max file-size cap** (the 5 MB limit is client-only), **MIME is
checked but not extension/magic-bytes**, and **Zod is not used for any request body** (only for
LLM output). Auth routes read `formData()` with **no try/catch and no field validation**.

## Detailed Findings

### API route inventory (8 files, 9 handlers)

Astro 6 (`output: "server"`, Cloudflare adapter) maps `src/pages/api/<path>.ts` → `/api/<path>`;
`[id]` is a dynamic segment. No `PUT`/`PATCH` handlers exist.

| File | URL | Methods | Purpose |
|------|-----|---------|---------|
| `src/pages/api/auth/signin.ts` | `/api/auth/signin` | POST | Email/password sign-in; **redirects** |
| `src/pages/api/auth/signup.ts` | `/api/auth/signup` | POST | Sign-up; **redirects** |
| `src/pages/api/auth/signout.ts` | `/api/auth/signout` | POST | Sign-out; **redirects** |
| `src/pages/api/profiles.ts` | `/api/profiles` | GET | Lists shared `job_profiles` |
| `src/pages/api/llm/health.ts` | `/api/llm/health` | POST | Auth'd LLM smoke test (ignores body) |
| `src/pages/api/analysis/index.ts` | `/api/analysis` | POST | Upload/paste/retry CV; create + background pipeline |
| `src/pages/api/analysis/[id]/index.ts` | `/api/analysis/:id` | GET, DELETE | Full payload / delete with cleanup |
| `src/pages/api/analysis/[id]/status.ts` | `/api/analysis/:id/status` | GET | Lightweight status poll |

### Auth model & middleware (`src/middleware.ts`)

`src/middleware.ts:1-25` populates **only** `context.locals.user` (via `supabase.auth.getUser()`)
— there is **no `locals.supabase`**; each handler calls `createClient(...)` again. Critically:

```4:21:src/middleware.ts
const PROTECTED_ROUTES = ["/dashboard"];
// ...
  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }
```

- **`/api/*` is NOT in `PROTECTED_ROUTES`.** Middleware never redirects API requests; each handler
  enforces auth itself, returning **401 JSON** (`{ error: "Authentication required", code: "UNAUTHORIZED" }`)
  when `!context.locals.user`.
- `App.Locals` (`src/env.d.ts:1-6`) = `{ user: User | null; cfContext: { waitUntil } }`.

### Risk #4 — where ownership is (and isn't) enforced

**Per-request Supabase client** (`src/lib/supabase.ts:6-24`) uses `SUPABASE_KEY` (documented as the
**anon** public key, `README.md:151-156`) via `createServerClient` with cookie forwarding. Session
JWT travels in cookies → PostgREST runs as `authenticated` with `auth.uid()` → **RLS applies**.
There is no `service_role` client anywhere in `src/`.

**RLS policies** (`supabase/migrations/20260527185003_data_schema_and_rls.sql`):

```146:160:supabase/migrations/20260527185003_data_schema_and_rls.sql
-- analyses: SELECT own rows
create policy "Users read own analyses"
  on public.analyses for select to authenticated
  using ( (select auth.uid()) = user_id );
-- analyses: INSERT own rows
create policy "Users insert own analyses"
  on public.analyses for insert to authenticated
  with check ( (select auth.uid()) = user_id );
-- analyses: UPDATE own rows
create policy "Users update own analyses"
  on public.analyses for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );
```

`analysis_questions` SELECT is gated by a subquery on owned `analyses` (lines 162-178);
`candidates` has SELECT+INSERT only (lines 136-144); DELETE policies live in
`supabase/migrations/20260530150600_analysis_delete_rls.sql:7-15`. `job_profiles` is shared
reference data (`using ( true )`, lines 132-134).

**Read paths and their ownership filters:**

| Location | Query filter | Ownership source | Cross-user → |
|----------|--------------|------------------|--------------|
| `src/pages/api/analysis/[id]/index.ts:21-25` (GET) | `.eq("id", id)` only | **RLS only** | 404 |
| `src/pages/api/analysis/[id]/status.ts:20-24` (GET) | `.eq("id", id)` only | **RLS only** | 404 |
| `src/pages/api/analysis/[id]/index.ts:84-89` (DELETE pre-read) | `.eq("id", id).eq("user_id", userId)` | **RLS + explicit** | 404 |
| `src/pages/api/analysis/index.ts:50-55` (POST retry) | `.eq("id", candidateId).eq("user_id", userId)` | **RLS + explicit** | 404 |
| `src/pages/dashboard/index.astro:19-24`, `[id].astro:14-15` (SSR) | by id / list, no `user_id` | **RLS only** | SSR may show `"parsing"` default for foreign id |

The DELETE handler documents the intentional 404 collapse:

```82:92:src/pages/api/analysis/[id]/index.ts
  // 1. Read the analysis scoped to the user (RLS + explicit eq enforce ownership).
  //    Not-owned and not-found are intentionally indistinguishable → 404.
  const { data: analysis, error: readError } = await supabase
    .from("analyses")
    .select("id, candidate_id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (readError ?? !analysis) {
    return jsonResponse({ error: "Analysis not found", code: "NOT_FOUND" }, 404);
  }
```

**Inserts** set `user_id` from the session, never from the body (`src/pages/api/analysis/index.ts:120-128`),
backed by INSERT RLS `with check`.

**Status-code matrix (denied / missing reads):**

| Endpoint | No session | Missing id param | DB unconfigured | Non-existent id | **Another user's id** | Own id |
|----------|-----------|------------------|-----------------|-----------------|-----------------------|--------|
| GET `/api/analysis/:id` | 401 | 400 | 503 | **404** | **404** | 200 |
| GET `/api/analysis/:id/status` | 401 | 400 | 503 | **404** | **404** | 200 |
| DELETE `/api/analysis/:id` | 401 | 400 | 503 | **404** | **404** | 200 |
| POST `/api/analysis` (retry bad candidate_id) | 401 | — | 503 | **404** | **404** | 201 |

### Risk #7 — server-side input validation

**Response helper** (the only shared API util):

```1:6:src/lib/api/response.ts
export function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
```

**`POST /api/analysis`** — the only route with real input validation:

- Reads `multipart/form-data` only, guarded by try/catch → 400 `BAD_REQUEST` on malformed body
  (`src/pages/api/analysis/index.ts:24-30`).
- Requires `job_profile_id` as a string (39-41); CV source must be one of `candidate_id` / `file`
  instanceof `File` / non-empty `cv_text` (48-81); `first_name`/`last_name` trimmed only, no length cap.
- File path → `extractText(file)` (`src/lib/cv-parser/index.ts:10-32`): **MIME-only** dispatch
  (`application/pdf`, DOCX) → `UNSUPPORTED_FORMAT`; empty extract → `EMPTY_CONTENT`.
- All CV paths converge on `assertUsableCvText(cvText)` (`src/lib/cv-parser/quality.ts:87-94`) →
  `INSUFFICIENT_CONTENT` on garbage.
- `CVParseError` (`src/lib/cv-parser/errors.ts:1-11`, codes `UNSUPPORTED_FORMAT | PARSE_FAILED |
  EMPTY_CONTENT | INSUFFICIENT_CONTENT`) maps inline to **400** in the route (71-72, 86-87). There is
  **no central status map**.

**Gaps (Risk #7):**

| Gap | Where | Consequence |
|-----|-------|-------------|
| **No server-side max file size** | only client `MAX_SIZE_MB = 5` in `src/components/analysis/FileUpload.tsx:10-27`; no `file.size` check in API or parser; no `wrangler.jsonc`/`astro.config.mjs` body limit | oversized upload accepted server-side |
| **MIME-only type check** | `src/lib/cv-parser/index.ts:11` (`file.type`) | spoofed content-type; extension/magic-bytes not verified |
| **No `cv_text` max length** | `src/pages/api/analysis/index.ts:76-77` | huge paste payloads |
| **No UUID/format validation on ids** | `job_profile_id`, `candidate_id`, path `:id` | garbage `job_profile_id` may surface as **500 `DB_ERROR`** rather than 4xx |
| **Auth routes: no `formData` try/catch, no field validation** | `src/pages/api/auth/signin.ts:4-7`, `signup.ts` | malformed body → uncaught 500; missing fields → passed to Supabase as `undefined` |
| **No Content-Type guard** | `analysis/index.ts:26-29` | `application/json` body likely → 400 via formData catch, but not explicit |

### Test infrastructure (what exists to build on)

- **Vitest 4.1.x** (`vitest.config.ts`), two projects via `extends: true`: `node`
  (`tests/lib/**/*.test.ts`, env `node`) and `components` (`tests/components/**`, jsdom + RTL,
  setup `tests/setup/dom.ts`). `globals: true`, `@`→`src` alias, `passWithNoTests: true`.
- Scripts: `npm run test` = `vitest run`, `npm run test:watch` = `vitest` (`package.json:14-16`).
  Test deps: `vitest ^4.1.7`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`,
  `jsdom ^29.1.1`. **No MSW**, no coverage tooling.
- **CI** (`.github/workflows/ci.yml:19-25`): `npx astro sync` then `npm run test`. Supabase env vars
  are injected for the **build** step only, **not the test step** — tests cannot rely on a real
  Supabase unless env is added to the test job.
- **API handlers are directly importable and callable** with a synthetic `APIContext`. The only
  existing precedent is `tests/lib/api/analysis-retry-garbage.test.ts`: it imports
  `POST` from `@/pages/api/analysis/index`, mocks `@/lib/llm` and **`@/lib/supabase`**, and builds a
  context with `locals.user`, `cfContext.waitUntil = vi.fn()`, and stub `cookies`.
- **LLM network-edge mock house style** (`tests/lib/llm/client.test.ts:7-12`): `vi.mock("ai", …)`
  on `generateText` + provider factory mocks — never real HTTP. This is the pattern Phase 3 should
  follow for the LLM edge (only relevant if a test reaches the pipeline).
- Fixtures: `tests/fixtures/analysis/*.json` (grounding triples), `tests/fixtures/cv/*.ts`
  (catchable / accepted-miss PII corpora). No binary PDF/DOCX (deferred per `test-plan.md:92`).
- **No `tests/helpers/`** for `makeApiContext`, a dual-user session harness, or an ownership-aware
  mock Supabase client. These do not exist yet and are the main net-new scaffolding for this phase.

## Code References

- `src/middleware.ts:4-21` — `PROTECTED_ROUTES = ["/dashboard"]`; `/api` is not guarded by middleware.
- `src/lib/supabase.ts:6-24` — anon-key `createServerClient` with cookie forwarding (RLS-respecting).
- `src/env.d.ts:1-6` — `App.Locals` = `{ user, cfContext.waitUntil }`; no `locals.supabase`.
- `src/lib/api/response.ts:1-6` — `jsonResponse` (only shared API helper).
- `src/pages/api/analysis/[id]/index.ts:21-25` — GET read by id only (RLS-dependent).
- `src/pages/api/analysis/[id]/index.ts:82-92` — DELETE explicit `user_id` + 404 collapse comment.
- `src/pages/api/analysis/[id]/status.ts:20-27` — status poll read by id only → 404.
- `src/pages/api/analysis/index.ts:24-90` — multipart parse, field checks, MIME dispatch, quality gate.
- `src/pages/api/analysis/index.ts:120-128` — analysis insert with `user_id` from session.
- `src/lib/cv-parser/index.ts:5-32` — MIME extractor map, `UNSUPPORTED_FORMAT`, `EMPTY_CONTENT`.
- `src/lib/cv-parser/quality.ts:87-94` — `assertUsableCvText` → `INSUFFICIENT_CONTENT`.
- `src/lib/cv-parser/errors.ts:1-11` — `CVParseError` codes.
- `src/components/analysis/FileUpload.tsx:10-27` — client-only 5 MB + MIME limit.
- `supabase/migrations/20260527185003_data_schema_and_rls.sql:146-178` — analyses/questions RLS.
- `supabase/migrations/20260530150600_analysis_delete_rls.sql:7-15` — DELETE RLS.
- `src/db/database.types.ts:25,39` — `analyses.user_id` (Row + required Insert).
- `vitest.config.ts:5-31` — alias, globals, two-project split.
- `.github/workflows/ci.yml:19-25` — test step has no Supabase env.
- `tests/lib/api/analysis-retry-garbage.test.ts:14-106` — only API-route test; mocks internal modules.
- `tests/lib/llm/client.test.ts:7-12` — `vi.mock("ai")` network-edge pattern.
- `scripts/run-manual-api-checks.mjs:50-76` — real-session cookie-jar pattern (live dev server, not Vitest).

## Architecture Insights

1. **Ownership is a database concern here, not an application concern (for reads).** Reads trust RLS;
   only mutating/retry paths add a redundant `user_id` filter. This is a legitimate Supabase pattern,
   but it relocates the test boundary: the thing that enforces isolation (RLS) is not in the code under
   test when the Supabase client is mocked.
2. **404-not-403 is a deliberate, documented choice** (`[id]/index.ts:82-83`) to avoid leaking
   existence of other users' resources. Tests must encode 404 as the contract; asserting 403 would be
   wrong against this codebase.
3. **The IDOR blast radius is `SUPABASE_KEY` provenance.** With the anon key, RLS holds; with a
   `service_role` key, every read becomes a full IDOR regardless of handler filters. A config-level
   guard/assert is arguably higher-leverage than a per-route test.
4. **Validation is centralized at one chokepoint by accident, not by design.** `POST /api/analysis`
   converges all CV sources on `assertUsableCvText`, but there's no shared request-validation layer,
   no body-size guard, and no Zod for inputs — so each new route re-implements (or forgets) validation.
5. **Test-policy vs. precedent mismatch.** `test-plan.md` §6.2/§6.4 mandate "mock only the external HTTP
   edge; never mock internal modules," but the sole existing API test mocks `@/lib/supabase` (an
   internal module). Phase 3 must resolve this: define what "the external edge" means for a
   Supabase-backed handler (real DB + RLS, or an ownership-enforcing fake).

## Historical Context (from prior changes)

- `context/changes/testing-output-grounding-response-integrity/` — **Phase 1 (done)**, Risks #1/#2.
  Established the fixture-driven grounding approach and the Vitest `projects` split; Risk #2 turned
  out to be a `CATEGORY_LABELS` vocabulary bug, not a parse failure (`test-plan.md` §6.6).
- `context/changes/testing-input-integrity-parsing-anonymization/` — **Phase 2 (done)**, Risks #5/#3.
  Added the `assertUsableCvText` quality gate at the single `cvText` convergence point and the
  `anonymizeCV → buildAnalysisPrompt` boundary assert. The "additive gate at a chokepoint" and
  "falsifiable fixtures, not silently fixed" philosophy (`test-plan.md` §6.7-6.8) should carry into Phase 3.
- `test-plan.md:49,65` and `change.md:17-18` explicitly mark Risk #4 as **not yet covered** by tests.

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Response Guidance rows #4, #7), §3 (rollout), §5 (gate:
  "API / boundary integration" required after Phase 3), §6.4 (cookbook stub — TBD this phase).
- No prior `research.md` exists for Phases 1–2 under `context/changes/**` to cross-link.

## Open Questions

1. **How do we exercise RLS in CI?** Reads depend on RLS, which a mocked client can't test, and CI has
   no Supabase env on the test step. Options: (a) add a Supabase test project + two seeded users + JWT
   cookies (real RLS, infra cost, CI secrets); (b) build an ownership-enforcing fake Supabase client in
   `tests/helpers/` that filters by `user_id` (fast, but tests the fake's logic, not real RLS); (c) a
   thin DB-level RLS test (SQL) separate from route tests. This is the central plan decision.
2. **Should Phase 3 close the Risk #7 gaps it documents** (server-side file-size cap, extension/magic-byte
   check, Zod request schemas, auth-route `formData` try/catch), or only *test* current behavior and
   defer fixes? Several gaps currently produce 500s where a 4xx is expected.
3. **Is a `SUPABASE_KEY`-is-anon assertion in scope?** A startup/config guard that refuses a
   `service_role` key would protect the IDOR blast radius more durably than route tests.
4. **Does the SSR `dashboard/[id].astro:14-15` "parsing" default leak** anything meaningful for a foreign
   id, or is it benign (no result data rendered)? Worth a quick confirmation if SSR is in test scope.
5. **`candidates` has no UPDATE RLS policy** (migrations) — the background `pii_map` update at
   `src/pages/api/analysis/index.ts:161` may affect 0 rows under RLS. Out of scope for isolation reads,
   but a latent pipeline-integrity issue relevant to Phase 4.
