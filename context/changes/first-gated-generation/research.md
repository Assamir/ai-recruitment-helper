---
date: 2026-05-29T18:11:00+02:00
researcher: AI Agent (Cursor)
git_commit: cf1a63a0c730a0532364e238ab8c5c2928b686e0
branch: main
repository: ai-recruitment-helper
topic: "S-01 First Gated Generation — end-to-end architecture and data flow"
tags: [research, codebase, s-01, architecture, pipeline, file-upload, anonymization, llm, ui]
status: complete
last_updated: 2026-05-29
last_updated_by: AI Agent (Cursor)
---

# Research: S-01 First Gated Generation — Architecture & Data Flow

**Date**: 2026-05-29T18:11:00+02:00
**Researcher**: AI Agent (Cursor)
**Git Commit**: cf1a63a0c730a0532364e238ab8c5c2928b686e0
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

How should the S-01 first-gated-generation pipeline be architected end-to-end? Specifically: the upload → parse → anonymize → LLM → store → display data flow, covering file parsing on the workerd runtime, PII anonymization strategy, LLM prompt pipeline and response schema, DB integration, progress indicators, and results UI.

## Summary

S-01 is the largest and most critical slice — the north-star that proves QA-specific CV auditing surfaces interview-worthy anomalies. The pipeline has six execution stages that map to four distinct engineering concerns:

1. **File upload & text extraction**: PDF parsing works on workerd via WASM-based libraries (`unpdf` for PDF, `office-oxide-wasm` for DOCX). The legacy `pdf-parse` and `mammoth.js` do NOT work. A paste-CV-text fallback exists as a designed safety net.
2. **PII anonymization**: A hybrid regex + section-aware rules approach is the pragmatic MVP choice. Regex handles structured PII (emails, phones, URLs); section-aware heuristics catch names and company names in contact headers. Placeholder replacement preserves analytical structure for the LLM.
3. **LLM analysis**: A single `completeLLM()` call with a QA expert system prompt and the anonymized CV + job profile. The response is a flat array of questions with category tags, plus a match summary — mapping directly to the F-01 database schema.
4. **Results UI**: A new analysis page under `/dashboard` with a React form (file upload + profile selector), Server-Sent Events or polling for progress, and a categorized results panel.

The 55-second timeout budget is sufficient: text extraction (<1s) + anonymization (<100ms) + LLM call (10-25s estimated) + DB writes (<500ms) = ~12-27s total, well under the limit.

## Detailed Findings

### 1. File Upload & Text Extraction on workerd

#### The Problem

The roadmap flagged a key unknown: "Can PDF/DOCX parsing libraries (`pdf-parse`, `mammoth`) run on the workerd runtime?" AGENTS.md warns that these libraries "may rely on unsupported Node.js internals."

#### Answer: They Cannot — But WASM Alternatives Exist

**PDF parsing — `pdf-parse` does NOT work on workerd.** It depends on native Node.js binaries and filesystem access incompatible with V8 isolates. Three viable alternatives exist:

| Library | Approach | workerd-safe | Size | Notes |
|---------|----------|-------------|------|-------|
| **`unpdf`** | PDF.js serverless build | Yes | ~700KB | Most mature; built specifically for serverless/edge. Zero deps. Used by other recruiting SaaS on Workers. |
| **`pdf-oxide-wasm`** | Rust→WASM | Yes | ~2MB | Fastest (0.8ms/doc). 100% pass rate on 3,830 test PDFs. Explicit Cloudflare Workers support. |
| **`pdfjs-serverless`** | PDF.js single bundle | Yes | ~500KB | Lightweight alternative; has a working Cloudflare Workers example in its README. |

**Recommendation**: Start with **`unpdf`** — it's the most battle-tested in serverless AI applications, has the simplest API (`extractText`), and is explicitly designed as a modern replacement for `pdf-parse`.

**DOCX parsing — `mammoth.js` likely does NOT work on workerd.** It relies on Node.js `Buffer` and potentially filesystem access. Alternative:

| Library | Approach | workerd-safe | Notes |
|---------|----------|-------------|-------|
| **`office-oxide-wasm`** | Rust→WASM | Yes | Handles DOCX/XLSX/PPTX + legacy DOC/XLS/PPT. 100% pass rate on 6,062-file corpus. MIT/Apache-2.0. |

**Recommendation**: Use **`office-oxide-wasm`** for DOCX text extraction. It produces HTML which can be stripped to plain text.

#### File Upload Mechanism

No file upload infrastructure exists in the codebase. The implementation needs:

1. **API route**: A new `POST /api/analysis/upload` route receiving `multipart/form-data` with the CV file and job profile ID.
2. **Request handling**: Use `request.formData()` (already used in auth routes) to access the `File` object, then `file.arrayBuffer()` for parsing.
3. **No R2 needed for MVP**: CV files are small (50KB-2MB). Extract text in-Worker, store only the extracted text in `candidates.cv_text`. The original file is not persisted.
4. **Compatibility**: The `formdata_parser_supports_files` flag may be needed in `wrangler.jsonc` to ensure `formData.get()` returns a `File` object instead of a string on Workers.

#### Paste Fallback

The PRD's Socratic challenge on FR-001 explicitly kept a paste-CV-text fallback: "parsing quality is a solvable engineering problem (validation + fallback to paste)." The analysis form should include a text area for pasting CV text directly, bypassing file upload entirely. This is both a UX convenience and a safety net for parsing failures.

#### Code References

- `wrangler.jsonc` — `nodejs_compat` enabled, no R2 bindings
- `src/pages/api/auth/signin.ts:5` — existing `request.formData()` pattern
- `context/foundation/shape-notes.md` — paste fallback as explicit mitigation
- `context/foundation/infrastructure.md` — Workers request body limit is 100MB (paid plan), CVs are 50KB-2MB

### 2. PII Anonymization Strategy

#### GDPR Requirement

The PRD is unambiguous: "no raw PII (names, emails, phone numbers, company names, addresses) is exposed beyond the organization's boundary during analysis. All personal identifiers are stripped before any data crosses the organizational perimeter."

The organizational boundary: Cloudflare Workers and Supabase are inside. OpenRouter API calls cross the boundary.

#### Approach Evaluation

| Approach | Names | Emails | Phones | Companies | Addresses | workerd | Latency |
|----------|-------|--------|--------|-----------|-----------|---------|---------|
| **Regex-only** | No | Yes | Yes | No | Partial | Yes | <10ms |
| **LLM-based (local)** | Yes | Yes | Yes | Yes | Yes | No (prod) | +10-20s |
| **NER (compromise.js)** | Partial | Yes | Yes | Partial | Partial | Likely | ~100ms |
| **Hybrid regex+rules** | Partial | Yes | Yes | Partial | Partial | Yes | <50ms |

**Critical finding**: The shape-notes preference for "local model for anonymization + OpenRouter for reasoning" has a deployment gap — LM Studio at `localhost:1234` is unreachable from production Workers. The impl-review (F7) already noted this. A local-model-based anonymization strategy requires a self-hosted model accessible via public URL, which adds significant infrastructure complexity outside MVP scope.

#### Recommended Approach: Hybrid Regex + Section-Aware Rules

**Implementation strategy:**

1. **Structured PII (regex)**: Emails, phone numbers (international patterns), URLs/LinkedIn links, date-of-birth patterns. High reliability (~99% for emails, ~90% for phones).

2. **Section-aware rules**: Parse CV sections by header detection (Contact, Personal Details, Experience, Education). The first 3-5 lines of a CV almost always contain the candidate's name and contact details. "At/for/with [Company]" patterns catch most company references in experience sections.

3. **Placeholder replacement**: Replace detected PII with consistent, numbered placeholders:
   - `[CANDIDATE_NAME]` for the candidate's name
   - `[COMPANY_1]`, `[COMPANY_2]`, etc. for companies (numbered to preserve cross-references)
   - `[EMAIL]`, `[PHONE]`, `[ADDRESS]` for contact info
   - `[LOCATION_1]`, `[LOCATION_2]` for cities/locations

4. **PII map storage**: Store a `piiMap: Record<string, string>` (placeholder → original value) in the database. This is never sent to the LLM but allows the results UI to optionally rehydrate placeholders for the recruiter.

**What this won't catch (accepted MVP trade-offs):**
- Company names mentioned only in body text without contextual patterns
- First-name-only references in project descriptions
- Non-standard name formats in body text

**Mitigation**: Stripped contact details (email, phone, full name from header) make body-text mentions much harder to identify. The PRD says "in identifiable form" — partial anonymization significantly reduces identifiability.

#### Interface Contract

```typescript
interface AnonymizationResult {
  anonymizedText: string;
  piiMap: Record<string, string>;
  piiCount: {
    names: number;
    emails: number;
    phones: number;
    companies: number;
    addresses: number;
  };
}

function anonymizeCV(text: string): AnonymizationResult;
```

#### Code References

- PRD lines 83-84: GDPR requirement text
- PRD lines 35-36: PII safety guardrail
- `context/foundation/shape-notes.md` — hybrid approach preference
- `src/lib/llm/types.ts:17` — `DEFAULT_PROVIDER = 'lmstudio'` (unreachable on Workers)
- `src/lib/llm/client.ts:19-22` — lmstudio console.warn about Workers unreachability

### 3. LLM Prompt Pipeline & Response Schema

#### Architecture: Single LLM Call

**Recommendation: One `completeLLM()` call for the full analysis.**

Rationale:
- The 55s timeout budget allows one call but not two (viability test showed ~12.8s for a simpler prompt on local LM Studio; OpenRouter GPT-4o will likely be 10-25s for the full analysis)
- The four anomaly categories are interdependent — contradictions require the full career timeline, vague claims need job requirements context, missing elements need both CV and profile
- The existing `completeLLM` API is designed for single-call structured output — no new abstractions needed

#### Pipeline Stages Mapped to Execution

```
API route receives request
  │
  ├─ INSERT analysis row (status: 'parsing')
  │
  ├─ Extract text from file (<1s)
  │  UPDATE status → 'anonymizing'
  │
  ├─ Strip PII via regex+rules (<100ms)
  │  UPDATE status → 'analyzing'
  │
  ├─ completeLLM() call (10-25s)
  │  UPDATE status → 'generating'
  │
  ├─ INSERT analysis_questions rows
  │  UPDATE analysis → status: 'completed', match_summary
  │
  └─ Return analysis ID to client
```

**Status update optimization**: Each DB status update is a cross-network call to Supabase (20-80ms per AGENTS.md). Five transitions = 100-400ms overhead. The `analyzing → generating` transition is nearly instantaneous (Zod parse is <10ms) — consider skipping this DB update and going directly from `analyzing` to `completed` to save one round-trip. Visually, the frontend can show "generating" as a client-side state after receiving the "analyzing" update.

#### System Prompt Structure (Outline)

1. **Role**: "You are an expert QA recruitment analyst specializing in detecting gaps, contradictions, and inflated claims in QA/testing candidate CVs."
2. **Framework**: Define the four anomaly categories with descriptions and examples
3. **Constraints**: Reference only CV content; never fabricate claims; provide rationale for every question; include suggested expected answers; match summary is qualitative (no numeric score)
4. **Output format**: JSON structure specification

#### Response Schema (Zod v4)

```typescript
import { z } from "zod/v4";

const AnalysisCategory = z.enum([
  "missing_elements",
  "contradictions",
  "vague_claims",
  "anomalies",
]);

const AnalysisQuestion = z.object({
  category: AnalysisCategory,
  question: z.string(),
  rationale: z.string(),
  suggested_answer: z.string().nullable(),
});

const AnalysisResponseSchema = z.object({
  match_summary: z.string(),
  questions: z.array(AnalysisQuestion),
});
```

**Design decisions:**
- **Flat array with category field** (not nested by category) — maps directly to `analysis_questions` table INSERT shape and is simpler for the LLM to produce consistently
- **`suggested_answer` is nullable** — some questions may not have a clear expected answer
- **Empty categories** have no questions in the array (categories with no findings are omitted, not displayed as "0 findings" — per PRD FR-007 Socratic resolution)
- **`match_summary` is top-level** — maps to `analyses.match_summary` column

#### Token Budget

| Component | Estimated Tokens |
|-----------|-----------------|
| System prompt (persona + framework + constraints) | ~500-800 |
| CV text (~2000 words, anonymized) | ~2,500-3,000 |
| Job profile (description + expected_skills JSONB) | ~300-500 |
| Prompt instructions + JSON format spec | ~200-300 |
| **Input total** | **~3,500-4,600** |
| Expected response (10-20 questions + rationale + summary) | ~2,000-4,000 |
| **Total round-trip** | **~5,500-8,600** |

Well within single-call limits for any modern model (GPT-4o: 128K context). The bottleneck is latency, not tokens.

#### Mapping to Existing `completeLLM` API

```typescript
const { data, timing } = await completeLLM({
  model,
  schema: AnalysisResponseSchema,
  prompt: buildAnalysisPrompt(anonymizedText, jobProfile),
  systemPrompt: QA_ANALYSIS_SYSTEM_PROMPT,
  timeoutMs: 55_000,
  useStructuredOutput: false, // Default text+JSON extraction path
});
```

**Note on `useStructuredOutput`**: The F-02 impl-review addendum (A1) documented that `generateText` + manual JSON extraction is the default path. This works across models that don't support native structured output. If extraction failures become frequent with the more complex analysis schema, switch to `useStructuredOutput: true`. S-01 should test both paths early.

#### Code References

- `src/lib/llm/client.ts:61-104` — `completeLLM()` implementation
- `src/lib/llm/client.ts:48-59` — `extractJSON` helper (handles fenced and bare JSON)
- `src/lib/llm/types.ts:22-27` — existing `HealthCheckResponseSchema` (simpler precedent)
- `context/changes/llm-integration-scaffold/plan.md:427-432` — addendum A1 on generateText vs generateObject
- `src/lib/llm/test-data.ts` — synthetic CV structure showing expected input format

### 4. DB Integration with F-01 Schema

#### Write Flow

S-01 writes to three tables in sequence:

1. **`candidates`** — INSERT one row per CV upload:
   ```
   { user_id, file_name, cv_text }
   ```
   - `linkedin_text` left null (S-03 scope)
   - `cv_text` stores the raw extracted text (before anonymization) — the recruiter needs the original for reference

2. **`analyses`** — INSERT one row per analysis run, UPDATE as stages progress:
   ```
   INSERT: { user_id, candidate_id, job_profile_id, status: 'parsing' }
   UPDATE (stages): { status: 'anonymizing' | 'analyzing' | 'generating' | 'completed' | 'failed' }
   UPDATE (completion): { match_summary, completed_at }
   UPDATE (failure): { error_message, status: 'failed' }
   ```
   - `custom_requirements` and `project_context` left null (S-02 scope)

3. **`analysis_questions`** — Batch INSERT after LLM response:
   ```
   questions.map((q, i) => ({
     analysis_id,
     category: q.category,
     question: q.question,
     rationale: q.rationale,
     suggested_answer: q.suggested_answer,
     sort_order: i,
   }))
   ```

#### Read Flow

The results page reads:

1. **`analyses`** — Fetch analysis metadata (status, match_summary, timing) for the current user
2. **`analysis_questions`** — Fetch questions for a specific analysis, ordered by `sort_order`
3. **`job_profiles`** — Fetch the selected profile's name and description for context display
4. **`candidates`** — Fetch the CV filename for display

All reads are filtered by RLS (`user_id = auth.uid()`) — no application-level access control needed.

#### RLS Considerations

The F-01 RLS policies enforce:
- `analyses` has an UPDATE policy restricted to `status`, `match_summary`, `error_message`, and `completed_at` columns — the pipeline can update status without being able to change `user_id` or `candidate_id`
- `analysis_questions` only allows INSERT and SELECT (no UPDATE/DELETE) — questions are immutable once written
- `candidates` allows INSERT and SELECT only — CV data is immutable once uploaded

#### Supabase Client Usage Pattern

```typescript
const supabase = createClient({ cookies: context.cookies });
if (!supabase) {
  return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
}

// Type-safe inserts using generated Database types
const { data, error } = await supabase
  .from("candidates")
  .insert({ user_id: user.id, file_name: file.name, cv_text: extractedText })
  .select("id")
  .single();
```

#### Code References

- `src/db/database.types.ts` — Generated types with Insert/Update/Row shapes for all 5 tables
- `src/lib/supabase.ts` — `createClient<Database>()` with typed returns
- `supabase/migrations/` — F-01 migration with schema, RLS, and indexes
- `context/changes/data-schema-and-rls/plan.md:76-122` — Full table contracts

### 5. Frontend Architecture & UI

#### Current State

- **Dashboard page** (`src/pages/dashboard.astro`): Placeholder with "Dashboard content coming soon..."
- **Components**: Only auth forms (`LoginForm.tsx`, `RegisterForm.tsx`) and a header (`Header.tsx`)
- **Pattern**: React 19 components with `client:load` directive in Astro pages, Tailwind 4 styling
- **No file upload, dropdown, or results components exist**

#### Proposed Page Structure

```
/dashboard              → Analysis list (existing page, needs content)
/dashboard/new          → New analysis form (file upload + profile selector)
/dashboard/[id]         → Analysis results (or progress if still running)
```

Alternatively, the new-analysis flow can be a modal or section on the main dashboard if the team prefers fewer pages.

#### Analysis Form Component

A React component handling:
1. **File upload**: Drag-and-drop zone + file picker for PDF/DOCX, with paste-as-text fallback textarea
2. **Job profile selector**: Dropdown populated from `job_profiles` table (9 seeded profiles)
3. **Submit button**: Posts to the analysis API route
4. **Validation**: Client-side file type/size checks before upload

#### Progress Indicators

The PRD requires "stage indicators (parsing, anonymizing, analyzing, generating)" (FR-006). Two approaches:

**Option A — Polling**: The client submits the analysis, receives an `analysis_id`, then polls `GET /api/analysis/[id]/status` every 2-3 seconds. The API reads `analyses.status` and returns it. Simple but adds DB read load.

**Option B — Server-Sent Events (SSE)**: The analysis API route holds the connection open and sends status events as stages complete. No polling needed. More elegant but requires the Worker to hold the connection for the full 10-25s analysis duration.

**Recommendation**: **Polling** for MVP simplicity. The Worker's response time is bounded (< 60s), and polling every 2-3s with 4-5 stages means ~10-15 DB reads — well within acceptable load. SSE adds complexity around connection management on Workers.

**Progress UI**: A step indicator showing 4 stages with active/completed/pending states:
```
[✓] Parsing → [✓] Anonymizing → [●] Analyzing → [ ] Generating
```

#### Results Display Component

A React component showing:
1. **Match summary**: 2-3 sentence qualitative assessment at the top (from `analyses.match_summary`)
2. **Categorized questions**: Tabs or sections for each populated category:
   - Missing Elements
   - Contradictions
   - Vague Claims
   - Anomalies
3. **Per question**: The question text, rationale (expandable or always visible), and suggested expected answer
4. **Empty categories are hidden** (per PRD FR-007 Socratic resolution)

#### Existing UI Patterns to Follow

From the auth form components:
- `useState` for form state and loading indicators
- `useRef` for form references
- Tailwind 4 utility classes for styling
- Error/success state management with conditional rendering
- `client:load` directive for React components in Astro pages

#### Code References

- `src/pages/dashboard.astro` — Placeholder page to extend
- `src/components/auth/LoginForm.tsx` — React form pattern with Tailwind
- `src/components/ui/Header.tsx` — Layout component pattern
- `src/layouts/Layout.astro` — Base layout with `<slot />`

### 6. Existing Codebase Integration Points

#### API Route Pattern (from health endpoint)

The `POST /api/llm/health` endpoint established the JSON API pattern S-01 must follow:

1. Check `context.locals.user` → 401 JSON if not authenticated
2. Check dependencies (config, model, supabase) → 503 JSON if unavailable
3. Execute business logic in try/catch → structured JSON response
4. Catch typed errors → specific HTTP status codes (502, 504, etc.)
5. All responses: `new Response(JSON.stringify(...), { headers: { "Content-Type": "application/json" } })`

#### Middleware Auth Flow

- `src/middleware.ts` runs on every request, populates `context.locals.user`
- Automatically redirects unauthenticated users from `/dashboard/*` to login
- API routes must check auth themselves — middleware only redirects for page routes
- S-01 analysis pages under `/dashboard/` get automatic protection

#### LLM Module Public API

Import from `@/lib/llm`:
- `getLLMConfig()` → `LLMConfig | null`
- `createLLMModel(config)` → `LanguageModel | null`
- `completeLLM<T>({ model, schema, prompt, systemPrompt, timeoutMs, useStructuredOutput })` → `{ data: T, timing: LLMTimingMetrics }`
- Error types: `LLMConnectionError`, `LLMTimeoutError`, `LLMParseError`, `LLMConfigError`

## Architecture Insights

### End-to-End Pipeline Architecture

```
Client (Browser)                    Worker (Cloudflare)                  External
─────────────────                   ───────────────────                  ────────
                                                                        
  ┌─────────────┐    POST           ┌───────────────────┐              
  │ Analysis    │───formData───────>│ /api/analysis      │              
  │ Form        │                   │                    │              
  │ (React)     │                   │ 1. Auth check      │              
  │             │                   │ 2. Parse file      │──unpdf/oxide─┐
  │             │                   │ 3. INSERT candidate │             │
  │             │<──{analysis_id}───│ 4. INSERT analysis  │             │
  │             │                   │ 5. Anonymize text   │             │
  │             │                   │ 6. completeLLM()   │──────────────>│ OpenRouter
  │             │    GET /status    │ 7. Parse response   │<─────────────│ API
  │ Progress    │───poll 2-3s──────│ 8. INSERT questions  │              
  │ Indicator   │<──{status}───────│ 9. UPDATE completed │              
  │             │                   └───────────────────┘   Supabase
  │             │    GET /results                           ──────────
  │ Results     │───────────────────────────────────────────>│ analyses
  │ Panel       │<──{questions}─────────────────────────────<│ questions
  └─────────────┘                                           │ profiles
                                                            └──────────
```

### Key Architectural Decisions

1. **Synchronous pipeline with status polling** — the analysis API route runs the full pipeline (parse → anonymize → LLM → store) in one request, updating DB status at each stage. The client polls for progress. This is simpler than async job queues and fits within the Workers execution model.

2. **No file persistence** — extracted text is stored in `candidates.cv_text`; the original file is discarded after parsing. For MVP, there's no need for R2 or file storage. If re-parsing is needed later (e.g., with a better parser), the recruiter re-uploads.

3. **Anonymized text sent to LLM, raw text stored in DB** — the recruiter sees the original CV in the results context, but only the anonymized version crosses the organizational boundary to OpenRouter.

4. **Flat question array, not nested categories** — the LLM returns `{ match_summary, questions: [{ category, question, rationale, suggested_answer }] }`. This maps 1:1 to DB rows and is easier for the LLM to produce consistently than deeply nested objects.

5. **Default `useStructuredOutput: false`** — uses the text+JSON extraction path proven in the viability test. The more complex analysis schema should be tested against real LLM responses early. Switch to `useStructuredOutput: true` if extraction failures are frequent.

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PDF/DOCX parsing fails on specific files | Medium | Medium | Paste-CV-text fallback; test with diverse real CVs early |
| LLM times out for long CVs | Low | High | 55s timeout is generous; truncate CV text if > 3000 words |
| PII leaks through anonymization gaps | Medium | High | Regex catches structured PII (email, phone); accepted gap for body-text company names |
| LLM produces invalid JSON | Medium | Medium | `extractJSON` handles fenced/bare JSON; Zod validates; test with target models |
| LLM hallucinates non-CV content | Low | Medium | System prompt constrains to CV content only; no post-generation validation in MVP |
| WASM libraries exceed Worker memory | Low | Low | `unpdf` is ~700KB, `office-oxide-wasm` is ~2MB; Worker memory limit is 128MB |
| Cross-network latency to Supabase stacks | Low | Low | 5 status updates × 20-80ms = 100-400ms overhead; optimize by skipping `generating` stage |

## Historical Context (from prior changes)

### F-01: Data Schema and RLS (implemented)

`context/changes/data-schema-and-rls/plan.md` — Fully implemented. Five tables deployed with RLS, indexes, and 9 seeded QA job profiles. The schema anticipates S-01 through S-03 columns. Key detail: the `analyses` UPDATE policy restricts which columns can be changed (status, match_summary, error_message, completed_at) — the pipeline can't accidentally overwrite `user_id` or `candidate_id`.

### F-02: LLM Integration Scaffold (impl_reviewed)

`context/changes/llm-integration-scaffold/plan.md` — Implemented with review. The `completeLLM()` service function is S-01's primary interface to the LLM. Key deviations documented in the impl-review:
- Uses `generateText` instead of `generateObject` (accepted; works across models)
- `extractJSON` helper handles fenced and bare JSON extraction
- Null output check added for structured output mode
- Error classification improved (SyntaxError instead of string matching)
- Missing `completeLLM` tests were added (7 tests covering success, error, and timeout paths)
- Synthetic CV expanded to ~2000 words for realistic timing

Unchecked manual verification items from F-02: 3.4, 3.6, 5.4, 5.6 (require live service testing).

## Related Research

No prior research artifacts exist under `context/changes/` or `context/archive/` for S-01.

## Open Questions

1. **`unpdf` vs `pdf-oxide-wasm`**: Which PDF library performs better on real QA CVs with tables, multi-column layouts, and embedded images? Needs testing with diverse real files via `wrangler dev --remote`.

2. **`office-oxide-wasm` WASM size on Workers**: The ~2MB WASM bundle for DOCX parsing may affect cold start times. Test whether the size is acceptable or whether DOCX support should be deferred to a later slice (PDF + paste covers most use cases).

3. **`useStructuredOutput` for complex schema**: The analysis response schema is more complex than the viability test's `HealthCheckResponse`. Does the text+JSON extraction path reliably produce valid JSON for 10-20 question responses? Test early with target models.

4. **Pipeline atomicity**: If the LLM call succeeds but the `analysis_questions` INSERT fails, the LLM response is lost. Should S-01 store the raw LLM response text alongside the analysis row (a `raw_response` column in `analyses`) for replay? This would require a schema migration.

5. **Frontend routing**: Should the analysis flow use new pages (`/dashboard/new`, `/dashboard/[id]`) or a single-page approach with client-side routing on the existing dashboard? Pages align with Astro's file-based routing and are simpler; SPA feels smoother for the status polling flow.

6. **`formdata_parser_supports_files` compatibility flag**: Does the current `wrangler.jsonc` compatibility date (`2025-04-01`) include this flag by default, or does it need to be explicitly added? Test file upload on `wrangler dev --remote` early.
