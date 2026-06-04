# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-04 (Phase 3 shipped)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression. For this product, the sharpest trap is the **oracle problem**:
   never assert that LLM output is "correct" by comparing it to the model's
   own output — anchor the expected result in the CV/JD input or the schema.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data. The user's stated
   top fear here — *"we will hire the wrong person; the analysis must be
   correct"* — is the spine of this rollout.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is produced
   by `/10x-research` during each rollout phase. If the plan and research
   disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/` (20 commits/30d;
excludes docs, `context/`, build output, and generated `db/database.types.ts`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | LLM generates questions/anomalies referencing claims **not present** in the CV or job requirements (hallucinated red flags, invented timeline details) → recruiter probes a fabricated issue and misjudges the candidate | High | High | PRD Guardrails "No hallucination"; interview Q1 + Q4; hot-spot `src/lib/llm` (9/30d), `src/lib/analysis` (3/30d), `src/components/analysis` (8/30d) |
| 2 | LLM response shape drifts; parser silently drops a category or mislabels findings, so the recruiter sees a confident-but-incomplete analysis and trusts it | High | High | PRD FR-007 (empty categories hidden — can mask a parse failure as "no findings"); hot-spot `src/lib/llm` (9/30d), `src/lib/analysis` (3/30d) |
| 3 | Raw PII (name, email, phone, company) survives anonymization and crosses the org boundary into the LLM call or the exported report | High | Medium | PRD NFR Privacy/GDPR + Guardrails "PII safety"; hot-spot `src/lib/anonymizer` (4/30d) |
| 4 | Recruiter A reaches recruiter B's analysis via the API (IDOR / RLS gap) — authentication passes but ownership is not enforced | High | Medium | PRD Access Control + Guardrails "Data isolation"; abuse lens (auth present); hot-spot `src/pages/api` (12/30d, no tests) |
| 5 | Garbage CV text from `unpdf`/`docx` parsing (empty/scanned PDF, odd format) feeds the pipeline silently → analysis looks correct but is built on nothing | High | Medium | PRD FR-001 Socratic (fragile parsing); AGENTS.md workerd≠Node warning; hot-spot `src/lib/cv-parser` (6/30d) |
| 6 | Analysis pipeline breaks at an integration boundary (upload→anonymize→LLM→parse→store) under real conditions, or fails silently instead of erroring cleanly | Medium | Medium | roadmap S-01 unknowns; AGENTS.md (deploy kills in-flight, workerd compat); hot-spot `src/pages/api` (12/30d), `src/components/analysis` (8/30d) |
| 7 | API routes accept unvalidated input (oversized file, wrong type, malformed body) → crash or undefined behavior | Medium | Medium | PRD FR-001/FR-003; abuse lens (untrusted input); hot-spot `src/pages/api` (12/30d) |

> Noted, not a row: mass-triggering the costly ~60s LLM analysis is High-impact
> × **Low**-likelihood for an internal small-scale tool (`target_scale: small`).
> It belongs to rate-limiting / observability, not a test (see §4, §8).

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Every claim referenced in generated output traces back to a span in the CV/JD input (faithfulness/entailment) | "valid JSON shape ⇒ content is grounded" | where output is assembled; whether the input docs are available at assert time to serve as the oracle | integration with recorded `(CV, JD, response)` fixtures; AI-native judge only if deterministic entailment can't catch it cheaply | the oracle problem — asserting exact LLM text, or deriving the expected answer from the model output itself |
| #2 | Malformed / missing-category responses are rejected or surfaced as errors, never silently rendered as "no findings" | "empty category = no anomalies" vs a parse failure | the response contract and where "empty vs missing" is decided | unit (schema/parse against malformed fixtures) | testing only the well-formed happy-path response |
| #3 | No raw PII string reaches the LLM call site or the export, across messy real-CV formats | "anonymizer unit tests pass ⇒ no PII crosses the boundary" | the actual boundary call site where anonymized text is handed to the LLM / export | integration at the boundary + fixture corpus | testing the anonymizer in isolation only, never at the call site |
| #4 | A request for another user's analysis id returns 403/404, not their data | "logged in ⇒ authorized" (ownership ≠ authentication) | where ownership is enforced (route handler vs RLS); the status a denied cross-user read returns | integration against the API acting as a second user | testing only that auth is required, not that ownership is enforced |
| #5 | Empty / garbage parse output is detected and rejected, not passed downstream as valid CV text | "parser returned a string ⇒ parse succeeded" | what the parser returns for empty/scanned/odd files; how downstream detects "no usable text" | unit with a real-ish CV fixture corpus (incl. empty/scanned) | a single clean fixture; asserting only "no throw" |
| #6 | The orchestration holds together with a mocked LLM edge; failures surface as clean errors, not false success | "happy path passing ⇒ pipeline is sound" | the integration seams and error translation across the chain | integration with the LLM mocked at the network edge | over-mocking internal modules; e2e where integration suffices |
| #7 | Oversized / wrong-type / malformed input is rejected with a clean 4xx | "client-side validation is enough" (server must re-validate) | server-side validation entry points on each route | integration on API routes | trusting client-side validation; happy-path-only |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Output grounding & response integrity | Prove generated content references only real CV/JD input, and malformed LLM responses never render as a silent "no findings" | #1, #2 | integration (fixture-driven) + unit | **done** | context/changes/testing-output-grounding-response-integrity/ |
| 2 | Input integrity (parsing + anonymization) | Garbage CV text is rejected not analyzed; no PII crosses the boundary on real-world formats | #5, #3 | unit (fixture corpus) + integration at boundary | **done** | context/changes/testing-input-integrity-parsing-anonymization/ |
| 3 | Data isolation & API boundary | Cross-user reads are denied; API routes reject untrusted input | #4, #7 | integration on API routes | **done** | context/changes/testing-data-isolation-api-boundary/ |
| 4 | Pipeline integration & quality gates | End-to-end orchestration holds with a mocked LLM; lock the floor in CI | #6 + cross-cutting | integration + gates | not started | — |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | 4.1.x | three projects: `node` (`tests/lib/**`), `components` (jsdom), `rls` (`tests/rls/**`, gated by env); `globals:true`, `@`→`src` alias |
| API / network mocking | `vi.mock("ai")` at LLM edge | 2026-06-04 | `tests/lib/llm/client.test.ts`; grounding uses offline `(CV, JD, response)` JSON under `tests/fixtures/analysis/` |
| CV fixture corpus | `tests/fixtures/cv/` text corpus (Phase 2) | 2026-06-04 | Synthetic catchable/accepted-miss strings; binary `.pdf`/`.docx` deliberately deferred — extractor edge mocked in parser unit tests |
| e2e | none yet — optional | — | browser MCP available if a full deployed-shape failure ever needs it; not currently justified |
| accessibility | none yet — optional | — | out of scope per §7 (UI not a priority surface) |
| (optional) AI-native | LLM-as-judge for faithfulness — checked: 2026-06-04 | deferred | Phase 1 uses deterministic `findUngroundedClaims` in `tests/lib/analysis/faithfulness.ts`; judge only if this proves too noisy |

**Stack grounding tools (current session):**
- Docs: Context7 — available for Astro 6 / Vitest 4 / Supabase / Cloudflare Workers test setup and current APIs; checked: 2026-06-02
- Search: none — Exa.ai not available in current session; checked: 2026-06-02
- Runtime/browser: Cursor IDE browser MCP — available as a possible e2e/visual layer; not used (no current justification under cost × signal); checked: 2026-06-02
- Provider/platform: GitHub MCP (CI gate wiring), Cloudflare docs/observability MCP (Workers runtime + logs/metrics for the 60s budget) — relevant to Phase 4 quality gates; checked: 2026-06-02

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery only. Do not use MCP docs/search to infer code
failure anchors; those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout phase
lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local + CI | required (already wired) | syntactic / type drift |
| unit + integration | local + CI | required after §3 Phase 1 | grounding + parse + logic regressions |
| API / boundary integration | local + CI (`npm run test`) | **required** (Phase 3) | data-isolation + input-validation regressions; real-RLS lane gated (`npx vitest run --project rls`) |
| pipeline integration (mocked LLM) | CI on PR | required after §3 Phase 4 | broken cross-layer orchestration |
| analysis-latency / error observability | Cloudflare Workers logs/metrics | recommended after §3 Phase 4 | the ~60s budget + silent failures (not a unit test) |
| pre-prod smoke | between merge + prod | optional | environment-specific (workerd) failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: `tests/lib/<area>/` mirroring `src/lib/<area>/` (current convention).
- **Naming**: `<module>.test.ts`.
- **Reference test**: `tests/lib/anonymizer/patterns.test.ts`.
- **Run locally**: `npm run test` (or `npm run test:watch`).

### 6.2 Adding an integration test

- **Grounding (fixture-driven)**: load a triple from `tests/fixtures/analysis/*.json`
  (`anonymizedText`, `profile`, validated `response`). Assert with
  `findUngroundedClaims` in `tests/lib/analysis/faithfulness.ts` — zero findings
  for grounded runs; ≥1 finding for known-bad fabricated spans.
- **API routes (later)**: see §3 Phase 3 — exercise handlers, mock only the external
  HTTP edge; never mock internal modules.
- **Reference**: `tests/lib/analysis/faithfulness.test.ts`, `tests/lib/llm/client.test.ts`.

### 6.3 Adding an e2e test

- TBD — optional; only if a failure requires the full deployed Worker shape.
  Browser MCP is available (see §4).

### 6.4 Adding a test for a new API endpoint

- **Handler tests (always-on, CI):** import the `APIRoute` handler; build context with
  `tests/helpers/api-context.ts` (`makeApiContext`); mock `@/lib/supabase` to return
  `makeFakeSupabase` from `tests/helpers/fake-supabase.ts`. The fake **filters rows by
  `actingUserId`** — it models the handler contract ("zero owned rows → 404"), **not**
  real Postgres RLS. Mock `@/lib/llm` for `POST /api/analysis`; stub `locals.cfContext.waitUntil`.
- **404, never 403:** cross-user reads assert `status === 404` and `code === "NOT_FOUND"`
  (existence-hiding contract in `src/pages/api/analysis/[id]/index.ts`).
- **Real RLS (gated):** `tests/rls/*.test.ts` in the Vitest `rls` project — source of truth
  for Risk #4. Guard with `describe.skipIf(!process.env.SUPABASE_TEST_URL)`. Env:
  `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` (local: `supabase start`, then copy from
  `supabase status`). Run: `npx vitest run --project rls`.
- **Input validation:** synthetic `File` objects (no binary fixtures); assert 4xx and no
  DB insert on rejection. Reference: `tests/lib/api/analysis-input-validation.test.ts`,
  `tests/lib/api/auth-input-validation.test.ts`.
- **Reference isolation suite:** `tests/lib/api/analysis-isolation.test.ts`.
- **Config guard:** `isServiceRoleKey` in `src/lib/supabase-key.ts` — unit test in
  `tests/lib/supabase/key.test.ts`.

### 6.5 Adding a grounding/faithfulness test for analysis output

- **Oracle**: `anonymizedText` + `profile.name` + `profile.description` +
  `profile.expected_skills` (same join as `buildAnalysisPrompt`).
- **Helper**: `findUngroundedClaims(oracle, response)` in
  `tests/lib/analysis/faithfulness.ts` — salient-span extraction + token/bigram
  overlap (threshold `0.55`); whitelists anonymizer placeholders
  (`[CANDIDATE_NAME]`, `[EMAIL]`, `[PHONE]`, `[URL]`, `[COMPANY_N]`).
- **Fixtures**: add JSON under `tests/fixtures/analysis/`; include one deliberate
  ungrounded triple (fabricated skill absent from CV and profile) to keep the
  threshold falsifiable.
- **Never** use the model output as the oracle.

### 6.7 CV quality gate (Risk #5)

- **Production gate**: `assertUsableCvText` in `src/lib/cv-parser/quality.ts`, wired once
  at the resolved-`cvText` chokepoint in `src/pages/api/analysis/index.ts` (after
  file/paste/retry branches, before DB insert). Rejects non-empty garbage with
  `CVParseError("INSUFFICIENT_CONTENT")` → HTTP 400 (same mapping as other parse errors).
- **Unit tests**: `tests/lib/cv-parser/quality.test.ts` — include a **non-empty garbage**
  fixture that MUST fail and a **terse real CV** that MUST pass (falsifiability anchors).
- **Parser contract**: extend `tests/lib/cv-parser/index.test.ts` with mocked-extractor
  output; `extractText` does not gate quality — the chokepoint helper does.

### 6.8 Boundary PII-free assert (Risk #3)

- **Decisive assert**: for each catchable fixture in `tests/fixtures/cv/catchable.ts`,
  `buildAnalysisPrompt(anonymizeCV(cv).anonymizedText, profile)` must contain expected
  placeholders (`[EMAIL]`, `[PHONE]`, `[CANDIDATE_NAME]`, `[COMPANY_N]`) and **none** of
  the fixture's raw `piiValues`. Reference: `tests/lib/anonymizer/boundary.test.ts`.
- **Accepted gaps**: characterize pass-through in `tests/lib/anonymizer/index.test.ts` and
  `tests/fixtures/cv/accepted-miss.ts` — do not assert these are clean in the boundary test.
- **Section heuristics**: `tests/lib/anonymizer/section-rules.test.ts`.
- **Echo reasoning**: LLM only sees `anonymizedText`; PII echo ⊆ anonymizer misses — the
  boundary assert covers the org-boundary surface without a separate render-layer test.
- Optional: route the same prompt through `completeLLM` with `vi.mock("ai")` for call-site
  fidelity (`tests/lib/llm/client.test.ts` pattern).

### 6.6 Per-rollout-phase notes

**Phase 1 (2026-06-04):** Risk #2 was a pure `CATEGORY_LABELS` vocabulary bug in
`AnalysisResults.tsx` — schema categories were correct in DB/API. Grounding helper
needed strict salient-span rules; generic 4+ letter words produced noise. Vitest
`projects` split keeps the node suite isolated from jsdom.

**Phase 2 (2026-06-04):** Risk #5 — additive quality gate at the single `cvText`
convergence point; `EMPTY_CONTENT` unchanged for truly empty extraction. Risk #3 —
boundary assert at `anonymizeCV → buildAnalysisPrompt`; accepted MVP gaps documented
with falsifiable fixtures, not silently "fixed" in tests.

**Phase 3 (2026-06-04):** Risk #4 — handler contract via ownership-enforcing fake;
real RLS in gated `tests/rls/` lane; `service_role` key refused in `createClient`.
Risk #7 — server file-size cap (`MAX_CV_FILE_BYTES`), UUID guards, auth `formData`
try/catch. **Accepted follow-ups:** magic-byte verification, Zod request schemas, SSR
foreign-id paths, `candidates` UPDATE RLS (Phase 4).

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Auth flows (sign in / up / out)** — Supabase owns the mechanism; low payoff to re-test. Re-evaluate if a custom auth layer is added. (Source: Phase 2 interview Q5.)
- **UI layout / component snapshots** — brittle, break constantly, catch little. Re-evaluate if a specific screen becomes a recurring regression source. (Source: Phase 2 interview Q5.)
- **Generated code (`src/db/database.types.ts`)** — the generator is the test. Re-evaluate never, unless the generator itself is replaced. (Source: Phase 2 interview Q5.)
- **Mass-trigger / rate-limit abuse of the analysis endpoint** — High-impact but Low-likelihood for an internal small-user tool; handle via observability/rate-limiting, not a test. (Source: §2 calibration.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-04 (Phase 3 cookbook + status)
- Stack versions last verified: 2026-06-04
- AI-native tool references last verified: 2026-06-04

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
