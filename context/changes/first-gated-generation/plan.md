# First Gated Generation (S-01) Implementation Plan

## Overview

Build the north-star pipeline that proves QA-specific CV auditing surfaces interview-worthy anomalies. A recruiter uploads a CV (.pdf/.docx or paste), selects a predefined QA job profile, submits the analysis, sees real-time progress through stages, and views categorized interview questions (missing elements, contradictions, vague claims, anomalies) with rationale, suggested expected answers, and a match summary.

## Current State Analysis

### What exists:

- **Database**: 5 tables deployed with RLS and 9 seeded QA job profiles (F-01). Types generated in `src/db/database.types.ts`. `candidates`, `analyses`, `analysis_questions` tables anticipate S-01 columns but lack `pii_map` and `raw_response`.
- **LLM client**: `completeLLM()` in `src/lib/llm/client.ts` with timeout, error hierarchy, JSON extraction, and both structured and text-based output paths (F-02). Viability confirmed at ~12.8s for a realistic prompt.
- **Auth**: Supabase Auth via `@supabase/ssr`, middleware guards `/dashboard/*`, `context.locals.user` populated on every request. API routes check auth themselves.
- **API pattern**: `POST /api/llm/health` establishes the JSON API convention — `jsonResponse` helper, typed errors → HTTP status mapping, auth via `locals.user`.
- **Frontend**: Placeholder dashboard, auth forms only. Single shadcn `Button` component. No file upload, dropdown, tab, or results components. React islands via `client:load` in Astro pages. Tailwind 4 with cosmic glass theme.
- **Tests**: Vitest 4 with 3 test files covering LLM module. No DOM/component testing infrastructure. Not run in CI.

### What's missing (the delta S-01 builds):

- Schema migration adding `pii_map` (JSONB) to `candidates` and `raw_response` (TEXT) to `analyses`
- CV text extraction module (PDF via `unpdf`, DOCX via `office-oxide-wasm`)
- PII anonymization module (hybrid regex + section-aware rules)
- Analysis response schema, system prompt, and prompt builder
- Three API routes: pipeline trigger, status polling, full results
- Job profiles API route for frontend dropdown
- Dashboard analysis history list
- New analysis form with file upload + paste fallback + profile selector
- Analysis results page with progress stepper, categorized questions, and error handling

### Key Discoveries:

- `wrangler.jsonc` compatibility date `2026-05-08` is recent enough that `formdata_parser_supports_files` should be included by default — verify early with `wrangler dev --remote`
- `createClient(requestHeaders, cookies)` returns typed Supabase client; the pipeline can reuse it in `waitUntil()` since JWT from request cookies remains valid for the ~25s pipeline duration
- The `analyses` UPDATE RLS policy restricts changes to **own rows only** (auth.uid() = user_id) — it does not restrict columns. Pipeline UPDATE statements must explicitly target only `status`, `match_summary`, `error_message`, and `completed_at` to avoid accidentally overwriting `user_id` or `candidate_id`
- `analysis_questions` only allows INSERT and SELECT (no UPDATE/DELETE) — questions are immutable once written
- Astro 6 Cloudflare adapter exposes `context.locals.cfContext.waitUntil()` for background processing after response (the Astro 5 `locals.runtime.ctx` API was removed in @astrojs/cloudflare v13)
- Current `dashboard.astro` must be moved to `dashboard/index.astro` to support sub-routes (`/dashboard/new`, `/dashboard/[id]`)

## Desired End State

A logged-in recruiter visits `/dashboard`, sees their analysis history (or an empty-state prompt for new users), clicks "New Analysis", uploads a PDF/DOCX CV or pastes CV text, selects a QA job profile from a dropdown, submits, and is redirected to `/dashboard/[analysis_id]`. There, a 4-stage progress stepper (Parsing ✓ → Anonymizing → Analyzing → Generating) updates in real-time via 2-3s polling. On completion, the page shows a match summary and categorized interview questions with rationale and suggested answers. On failure, an inline error with a retry button appears. Empty categories are hidden. The original CV text is stored in the database; only the anonymized version crosses the organizational boundary to OpenRouter.

### How to verify:

1. Upload a real QA CV PDF → categorized questions appear within 60s
2. Paste CV text → same result, bypassing file parsing
3. Select different job profiles → questions are calibrated to the profile's expected skills
4. Check Supabase `analyses` table → `raw_response` contains the LLM output, `status` = 'completed'
5. Check `candidates` table → `pii_map` contains placeholder→original mappings
6. Log in as a different user → cannot see the first user's analyses
7. Kill LM Studio / use invalid API key → error state with retry button

## What We're NOT Doing

- **FR-003 custom requirements** — S-02 scope. The form only shows predefined profile selection.
- **FR-004 LinkedIn cross-reference** — S-03 scope. `candidates.linkedin_text` stays null.
- **FR-005 project context** — S-02 scope. `analyses.project_context` stays null.
- **FR-009 report export** — S-04 scope. No PDF/Markdown export.
- **Component tests** — No jsdom/RTL setup. Unit tests cover pure logic modules only.
- **PII rehydration in UI** — The `pii_map` is stored for future use but the results UI shows anonymized placeholders only in S-01.
- **SSE for progress** — Polling chosen for MVP simplicity.
- **R2 file storage** — Original files are discarded after text extraction; only `cv_text` is persisted.

## Implementation Approach

The pipeline is split into a synchronous front-half (file parsing + DB record creation) and an asynchronous back-half (anonymization + LLM analysis + result storage) using `context.locals.cfContext.waitUntil()` (Astro 6 Cloudflare adapter). This lets the API return an `analysis_id` immediately so the client can navigate to the results page and start polling for progress. The back-half updates the analysis status in the database at each stage, which the polling endpoint reads.

Five pure-logic modules are introduced: CV parser, PII anonymizer, analysis schema, prompt builder, and a shared API response utility. Each is independently testable. The frontend adds three new Astro pages with React islands for the interactive components.

## Critical Implementation Details

### Timing & lifecycle

The `POST /api/analysis` route must return the `analysis_id` to the client BEFORE the LLM call (10-25s). The synchronous part handles file parsing (<1s) and DB record creation (<500ms), then delegates the rest to `context.locals.cfContext.waitUntil()`. The Supabase client created from request cookies is captured in the `waitUntil()` closure — the JWT remains valid for the pipeline duration (~25s). Cookie-writing (`setAll`) is unused in the background; only DB reads/writes happen.

### State sequencing

The analysis status progresses: `'parsing'` (initial) → `'anonymizing'` → `'analyzing'` → `'completed'` / `'failed'`. The `'generating'` stage is shown client-side only (no DB write) to save a Supabase round-trip. If any background stage fails, the catch handler sets `status='failed'` and `error_message` on the analysis row. The polling endpoint reads whatever status is current.

---

## Phase 1: Schema Migration + CV Text Extraction Module

### Overview

Add two new columns to the database schema (`pii_map` on candidates, `raw_response` on analyses), install WASM-based file parsing libraries, and create a `src/lib/cv-parser/` module that extracts plain text from PDF and DOCX files. This phase establishes the data layer extension and the first pipeline stage.

### Changes Required:

#### 1. Database migration

**File**: `supabase/migrations/<timestamp>_s01_schema_extensions.sql`

**Intent**: Add `pii_map` JSONB column to `candidates` (stores placeholder→original PII mapping) and `raw_response` TEXT column to `analyses` (stores raw LLM output for replay safety). Both nullable with defaults, making this a backward-compatible additive migration.

**Contract**: Two `ALTER TABLE ... ADD COLUMN` statements. `pii_map` defaults to `NULL`, type `jsonb`. `raw_response` defaults to `NULL`, type `text`.

#### 2. Regenerate database types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate TypeScript types to include the new columns so downstream code gets type-safe access.

**Contract**: Run `npm run db:types` (the existing Supabase type generation script). The `candidates` Row/Insert/Update types gain `pii_map`, and `analyses` types gain `raw_response`.

#### 3. Install file parsing dependencies

**Intent**: Add `unpdf` (PDF text extraction, ~700KB, serverless-native) and `office-oxide-wasm` (DOCX/XLSX/PPTX via Rust→WASM, ~2MB) to the project.

**Contract**: `npm install unpdf office-oxide-wasm`. Both must work on the workerd runtime (V8 isolates, no Node.js filesystem).

#### 4. CV parser module

**File**: `src/lib/cv-parser/index.ts`

**Intent**: Create a module that accepts a `File` object (from `formData.get()`) and returns extracted plain text. Dispatches to PDF or DOCX extraction based on file MIME type. Rejects unsupported types with a descriptive error.

**Contract**: Exports `extractText(file: File): Promise<string>`. Throws `CVParseError` (a new error class) on parsing failure. Supported MIME types: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

#### 5. PDF extraction helper

**File**: `src/lib/cv-parser/pdf.ts`

**Intent**: Extract text from a PDF file using `unpdf`'s `extractText` API. Converts the `File` to an `ArrayBuffer` and passes it to the library.

**Contract**: Exports `extractPdfText(buffer: ArrayBuffer): Promise<string>`. Returns concatenated page text.

#### 6. DOCX extraction helper

**File**: `src/lib/cv-parser/docx.ts`

**Intent**: Extract text from a DOCX file using `office-oxide-wasm`. The library produces HTML output; strip HTML tags to get plain text.

**Contract**: Exports `extractDocxText(buffer: ArrayBuffer): Promise<string>`. Returns plain text with HTML stripped.

#### 7. CV parser error type

**File**: `src/lib/cv-parser/errors.ts`

**Intent**: Define `CVParseError` extending `Error` for parser-specific failures (unsupported format, corrupt file, empty extraction).

**Contract**: `CVParseError` with `code` field (`'UNSUPPORTED_FORMAT' | 'PARSE_FAILED' | 'EMPTY_CONTENT'`).

#### 8. Unit tests for CV parser

**File**: `tests/lib/cv-parser/index.test.ts`

**Intent**: Test the extraction dispatch logic, MIME type validation, and error handling. Mock `unpdf` and `office-oxide-wasm` at the module level (same pattern as `client.test.ts`).

**Contract**: Tests cover: PDF dispatches to PDF extractor, DOCX dispatches to DOCX extractor, unsupported MIME type throws `CVParseError('UNSUPPORTED_FORMAT')`, empty extraction result throws `CVParseError('EMPTY_CONTENT')`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `supabase db push` or `supabase migration up`
- Type regeneration includes new columns: `npm run db:types` && verify `pii_map` and `raw_response` in output
- Unit tests pass: `npm run test -- tests/lib/cv-parser/`
- Lint passes: `npm run lint`

#### Manual Verification:

- Upload a real PDF via `wrangler dev --remote` — text extraction returns readable content
- Upload a real DOCX file — text extraction returns readable content
- Verify WASM cold start is acceptable (< 3s) on Workers

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: PII Anonymization Module

### Overview

Create a `src/lib/anonymizer/` module that strips personally identifiable information from CV text using regex patterns for structured PII (emails, phones, URLs) and section-aware heuristics for semi-structured PII (candidate names, company names). Produces anonymized text with numbered placeholders and a PII map for optional future rehydration.

### Changes Required:

#### 1. Anonymizer types

**File**: `src/lib/anonymizer/types.ts`

**Intent**: Define the `AnonymizationResult` interface (anonymized text, PII map, and PII counts) that the research document specified as the module's public contract.

**Contract**:
```typescript
interface AnonymizationResult {
  anonymizedText: string;
  piiMap: Record<string, string>; // placeholder → original
  piiCount: { names: number; emails: number; phones: number; companies: number; addresses: number; };
}
```

#### 2. Regex patterns

**File**: `src/lib/anonymizer/patterns.ts`

**Intent**: Define regex patterns for detecting structured PII: email addresses, phone numbers (international formats), URLs/LinkedIn links, and date-of-birth patterns. Each pattern returns matches with their positions in the text.

**Contract**: Exports detection functions — each takes a string and returns `Array<{ match: string; start: number; end: number }>`. Patterns: email (~99% reliability), phone (~90% for international formats), URL (http/https + linkedin.com), date patterns (DD/MM/YYYY variants).

#### 3. Section-aware rules

**File**: `src/lib/anonymizer/section-rules.ts`

**Intent**: Detect semi-structured PII using CV section heuristics. The first 3-5 lines almost always contain the candidate's name and contact details. "At/for/with [Company]" patterns in experience sections catch most company references. Section headers (Contact, Personal Details, Experience, Education) help scope detection.

**Contract**: Exports functions for detecting candidate names from the header section and company names from experience sections. Returns the same `{ match, start, end }` array format as regex patterns.

#### 4. Main anonymizer function

**File**: `src/lib/anonymizer/index.ts`

**Intent**: Orchestrate all detection patterns, replace matches with numbered placeholders (`[CANDIDATE_NAME]`, `[COMPANY_1]`, `[EMAIL]`, `[PHONE]`, `[ADDRESS]`, `[LOCATION_1]`), and produce the `AnonymizationResult`. Replacements must be applied from end-of-string to start-of-string to preserve position indices.

**Contract**: Exports `anonymizeCV(text: string): AnonymizationResult`. Companies and locations use incrementing numbers (`[COMPANY_1]`, `[COMPANY_2]`) to preserve cross-references in the anonymized text.

#### 5. Unit tests for anonymizer

**File**: `tests/lib/anonymizer/index.test.ts`

**Intent**: Test the full anonymization pipeline against the `SYNTHETIC_CV_TEXT` from `src/lib/llm/test-data.ts` and against crafted edge cases. Verify that structured PII is reliably caught and that placeholder numbering is consistent.

**Contract**: Tests cover: emails replaced with `[EMAIL]`, phone numbers replaced with `[PHONE]`, URLs replaced with `[URL]`, candidate name from header replaced with `[CANDIDATE_NAME]`, company names replaced with numbered `[COMPANY_N]`, PII map contains correct original→placeholder mappings, PII counts are accurate, empty/whitespace-only input handled gracefully.

#### 6. Unit tests for patterns

**File**: `tests/lib/anonymizer/patterns.test.ts`

**Intent**: Test individual regex patterns in isolation against positive and negative examples. Ensures patterns don't over-match (false positives) on common QA terminology.

**Contract**: Tests cover: standard and non-standard email formats, international phone formats (US, EU, UK), LinkedIn URLs vs generic URLs, edge cases (emails inside URLs, phone-like version numbers).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test -- tests/lib/anonymizer/`
- Lint passes: `npm run lint`

#### Manual Verification:

- Run the anonymizer on `SYNTHETIC_CV_TEXT` — output is readable with clear placeholders replacing all PII
- PII map correctly maps each placeholder back to its original value
- No structured PII (emails, phones) leaks through in the anonymized text

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Analysis Pipeline — API Routes + LLM Prompt

### Overview

Define the Zod analysis response schema, build the QA expert system prompt and prompt builder, create the three API routes that drive the analysis pipeline (trigger, status poll, full results), and extract the `jsonResponse` utility to a shared module. This phase wires together the CV parser, anonymizer, and LLM client into a working end-to-end pipeline.

### Changes Required:

#### 1. Analysis response schema

**File**: `src/lib/analysis/schema.ts`

**Intent**: Define the Zod v4 schema for the LLM's structured response — a flat array of questions with category tags plus a match summary. This schema is used both for LLM response parsing and for type-safe access throughout the pipeline.

**Contract**: Exports `AnalysisResponseSchema` (Zod object with `match_summary: string` and `questions: array of { category: enum('missing_elements'|'contradictions'|'vague_claims'|'anomalies'), question: string, rationale: string, suggested_answer: string | null }`). Also exports `AnalysisCategory` enum and inferred TypeScript types.

#### 2. System prompt and prompt builder

**File**: `src/lib/analysis/prompt.ts`

**Intent**: Define the QA recruitment analyst system prompt (role, anomaly category framework, constraints, output format) and a function that builds the user prompt from anonymized CV text and job profile data.

**Contract**: Exports `QA_ANALYSIS_SYSTEM_PROMPT: string` and `buildAnalysisPrompt(anonymizedText: string, profile: { name: string; description: string; expected_skills: unknown }): string`. The system prompt constrains the LLM to reference only CV content, never fabricate claims, provide rationale for every question, and produce a qualitative match summary (no numeric score).

#### 3. Shared API response utility

**File**: `src/lib/api/response.ts`

**Intent**: Extract the `jsonResponse` helper from `health.ts` into a shared utility so all JSON API routes use the same response pattern.

**Contract**: Exports `jsonResponse(body: Record<string, unknown>, status: number): Response` with `Content-Type: application/json` header. The health endpoint is updated to import from this shared location.

#### 4. Extend App.Locals type for cfContext

**File**: `src/env.d.ts`

**Intent**: Declare the `cfContext` property on `App.Locals` so TypeScript recognizes `context.locals.cfContext.waitUntil()` in API routes. The Astro 6 Cloudflare adapter populates this at runtime but doesn't auto-generate the type.

**Contract**: Add `cfContext: import('@cloudflare/workers-types').ExecutionContext;` to the `App.Locals` interface alongside the existing `user` field.

#### 5. Analysis pipeline route

**File**: `src/pages/api/analysis/index.ts`

**Intent**: The main pipeline entry point. Receives a multipart form with CV file (or text) and job profile ID. Parses the file, creates DB records, then delegates the analysis pipeline to `waitUntil()` for background processing. Returns the `analysis_id` immediately so the client can start polling.

**Contract**: `POST /api/analysis`. Accepts `multipart/form-data` with fields: `file` (File, optional), `cv_text` (string, optional — paste fallback), `job_profile_id` (string, required), `candidate_id` (string, optional — retry shortcut). At least one of `file`, `cv_text`, or `candidate_id` must be present. When `candidate_id` is provided, the server reads the stored `cv_text` from the existing candidate record (skipping file parsing) and creates a new analysis linked to the same candidate. Returns `{ analysis_id: string }` on success (201), or error JSON (401 unauthorized, 400 validation, 503 service unavailable). Background pipeline updates analysis status through stages and catches errors to set `status='failed'`.

#### 6. Status polling route

**File**: `src/pages/api/analysis/[id]/status.ts`

**Intent**: Lightweight endpoint for the client to poll analysis progress. Reads the analysis status from the database and returns it.

**Contract**: `GET /api/analysis/[id]/status`. Returns `{ status: string, match_summary?: string, error_message?: string }` (200), or 401/404 JSON errors. RLS ensures only the analysis owner can read status.

#### 7. Full results route

**File**: `src/pages/api/analysis/[id]/index.ts`

**Intent**: Returns the complete analysis results — metadata, questions, candidate info, and profile info — for rendering the results page.

**Contract**: `GET /api/analysis/[id]`. Returns `{ analysis: {...}, questions: [...], candidate: { id, file_name }, profile: { id, name, description, expected_skills } }` (200), or 401/404 JSON errors. Questions are ordered by `sort_order`. The `candidate.id` is needed by the retry flow to pass as `candidate_id` to POST /api/analysis.

#### 8. Job profiles listing route

**File**: `src/pages/api/profiles.ts`

**Intent**: Provides the job profile list for the frontend dropdown. Read-only, requires authentication.

**Contract**: `GET /api/profiles`. Returns `{ profiles: Array<{ id, name, seniority_level, description }> }` (200) or 401 JSON error. Ordered by `name`, then `seniority_level`.

#### 9. Refactor health endpoint imports

**File**: `src/pages/api/llm/health.ts`

**Intent**: Replace the local `jsonResponse` function with the shared import from `src/lib/api/response.ts`.

**Contract**: Behavior unchanged. Delete the local `jsonResponse` definition, import from `@/lib/api/response`.

#### 10. Unit tests for analysis schema

**File**: `tests/lib/analysis/schema.test.ts`

**Intent**: Validate the Zod schema against well-formed and malformed analysis responses. Same testing pattern as `types.test.ts`.

**Contract**: Tests cover: valid response parses successfully, missing `match_summary` rejected, invalid category value rejected, `suggested_answer: null` accepted, empty questions array accepted, extra fields stripped.

#### 11. Unit tests for prompt builder

**File**: `tests/lib/analysis/prompt.test.ts`

**Intent**: Verify the prompt builder produces the expected structure — anonymized CV text and profile data are correctly interpolated into the prompt template.

**Contract**: Tests cover: prompt includes anonymized CV text, prompt includes profile name and description, prompt includes expected skills, system prompt contains the four anomaly categories, system prompt contains output format instructions.

### Success Criteria:

#### Automated Verification:

- Schema unit tests pass: `npm run test -- tests/lib/analysis/schema.test.ts`
- Prompt builder unit tests pass: `npm run test -- tests/lib/analysis/prompt.test.ts`
- Build succeeds: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- `POST /api/analysis` with a PDF file and profile ID returns `{ analysis_id }` within 2 seconds
- Status endpoint shows stage progression (anonymizing → analyzing → completed) when polled
- Full results endpoint returns categorized questions matching the schema after completion
- Submit with no auth → 401 JSON response
- Submit with no file and no cv_text → 400 JSON response
- LLM timeout → analysis status = 'failed' with error message
- Parse failure (corrupt PDF) → 400 error returned immediately (synchronous stage)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Frontend — Dashboard List + New Analysis Form

### Overview

Replace the placeholder dashboard with an analysis history list page, create a new analysis form page with file upload (drag-and-drop + picker), collapsible paste-CV-text fallback, and job profile dropdown selector. The `GET /api/profiles` route built in Phase 3 provides the data for the dropdown.

### Changes Required:

#### 1. Convert dashboard to directory-based routing

**File**: `src/pages/dashboard.astro` → `src/pages/dashboard/index.astro`

**Intent**: Move the existing dashboard page into a directory to support sub-routes (`/dashboard/new`, `/dashboard/[id]`). Astro file-based routing requires a directory with `index.astro` for this.

**Contract**: `src/pages/dashboard.astro` is deleted. `src/pages/dashboard/index.astro` replaces it. The route `/dashboard` continues to work.

#### 2. Dashboard page with analysis list

**File**: `src/pages/dashboard/index.astro`

**Intent**: Replace the placeholder content with an analysis history list (most recent first) and a prominent "New Analysis" button. Shows candidate file name, job profile name, status, and creation date for each analysis. Empty-state message for users with no analyses yet.

**Contract**: Astro page reads `analyses` joined with `candidates` and `job_profiles` from Supabase in the frontmatter. Renders a list with each analysis linking to `/dashboard/[id]`. The "New Analysis" button links to `/dashboard/new`. Auth-guarded by middleware (existing behavior).

#### 3. New analysis page

**File**: `src/pages/dashboard/new.astro`

**Intent**: Host the analysis form React component. Passes the job profiles list as a prop from Astro frontmatter.

**Contract**: Astro page reads `job_profiles` from Supabase in frontmatter, passes them to `<AnalysisForm profiles={profiles} client:load />`. Auth-guarded by middleware.

#### 4. Analysis form component

**File**: `src/components/analysis/AnalysisForm.tsx`

**Intent**: React form component handling file selection, optional paste fallback, profile selection, client-side validation, and form submission via `fetch()`. On successful submission, redirects to the analysis results page.

**Contract**: Props: `profiles: Array<{ id, name, seniority_level, description }>`. Manages state for: selected file, paste text, selected profile ID, loading, errors. Submits `FormData` to `POST /api/analysis`. Validates: at least one of file or paste text provided, profile selected, file type is PDF or DOCX, file size < 5MB. On success response with `analysis_id`, navigates to `/dashboard/{analysis_id}`.

#### 5. File upload sub-component

**File**: `src/components/analysis/FileUpload.tsx`

**Intent**: Drag-and-drop zone with file picker button for PDF/DOCX upload. Shows selected file name and size. Includes a collapsible "Paste CV text instead" section with a textarea.

**Contract**: Props: `file: File | null`, `onFileChange: (file: File | null) => void`, `cvText: string`, `onCvTextChange: (text: string) => void`. Accepts `.pdf` and `.docx` via `accept` attribute. Drag events change visual state. Paste fallback is a collapsible section (default collapsed).

#### 6. Profile selector sub-component

**File**: `src/components/analysis/ProfileSelector.tsx`

**Intent**: Dropdown for selecting a predefined QA job profile. Shows profile name with seniority level and a description preview.

**Contract**: Props: `profiles: Array<{...}>`, `selectedId: string | null`, `onChange: (id: string) => void`. Renders a styled `<select>` or custom dropdown with profile name + seniority level as option labels.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- `/dashboard` shows analysis history list for logged-in user (or empty state for new users)
- "New Analysis" button navigates to `/dashboard/new`
- File upload accepts PDF and DOCX files, rejects others with an error message
- Paste fallback textarea is accessible via collapse/expand toggle
- Job profile dropdown populates with 9 seeded profiles
- Form validation prevents submission without profile or CV input
- Successful form submission redirects to `/dashboard/[analysis_id]`
- Unauthenticated access to `/dashboard/new` redirects to sign-in

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Frontend — Progress Polling + Results Display

### Overview

Create the analysis results page (`/dashboard/[id]`) with a 4-stage progress stepper that polls for updates, a results panel showing the match summary and categorized interview questions, and inline error handling with retry. This phase completes the end-to-end user flow.

### Changes Required:

#### 1. Analysis results page

**File**: `src/pages/dashboard/[id].astro`

**Intent**: Astro page that hosts the `AnalysisView` React component. Reads the analysis ID from the URL parameter and passes it to the client component.

**Contract**: Dynamic route `[id]` extracts the analysis ID. Passes `analysisId` as a prop to `<AnalysisView analysisId={id} client:load />`. Auth-guarded by middleware.

#### 2. Analysis view component

**File**: `src/components/analysis/AnalysisView.tsx`

**Intent**: Top-level React component that orchestrates the analysis results page. Polls `GET /api/analysis/[id]/status` every 2-3 seconds while status is in-progress. When completed, fetches full results from `GET /api/analysis/[id]`. Delegates to sub-components for progress display, results rendering, and error handling.

**Contract**: Props: `analysisId: string`. State: `status`, `results`, `error`. Starts polling on mount. Stops polling when status is `'completed'` or `'failed'`. Shows `AnalysisProgress` while in-progress, `AnalysisResults` when completed, error state with retry when failed. Polling interval: 2-3 seconds via `setInterval` with cleanup on unmount.

#### 3. Progress stepper component

**File**: `src/components/analysis/AnalysisProgress.tsx`

**Intent**: Visual 4-stage progress indicator showing Parsing → Anonymizing → Analyzing → Generating with active/completed/pending states. The "Generating" stage is shown as active client-side after "Analyzing" completes (no DB write for this transition).

**Contract**: Props: `status: string`. Maps the DB status (`'parsing'` | `'anonymizing'` | `'analyzing'` | `'completed'`) to visual states. Each stage shows: ✓ (completed), ● (active/in-progress), ○ (pending). "Generating" is derived: active when DB status is `'analyzing'` and has been so for > 1 poll cycle, or when status transitions to `'completed'`.

#### 4. Results display component

**File**: `src/components/analysis/AnalysisResults.tsx`

**Intent**: Displays the match summary at the top, followed by interview questions grouped by category. Each populated category gets a section; empty categories are hidden (per PRD FR-007 Socratic resolution).

**Contract**: Props: `matchSummary: string`, `questions: Array<{ category, question, rationale, suggested_answer }>`, `profileName: string`, `candidateFileName: string`. Groups questions by category. Renders category sections in order: missing_elements, contradictions, vague_claims, anomalies. Each question shows the question text, rationale, and suggested answer (if non-null). Shows candidate file name and profile name as context header.

#### 5. Question card component

**File**: `src/components/analysis/QuestionCard.tsx`

**Intent**: Renders a single interview question with its rationale and optional suggested answer. The rationale can be expandable or always visible depending on space.

**Contract**: Props: `question: string`, `rationale: string`, `suggestedAnswer: string | null`. Styled to match the cosmic glass theme. Category badge shown in the card header.

#### 6. Error state with retry

**Intent**: When analysis status is `'failed'`, show the error message inline on the results page with a "Retry Analysis" button that re-submits the same CV and profile to `POST /api/analysis`.

**Contract**: Integrated into `AnalysisView`. On retry, creates a new analysis via `POST /api/analysis` with `candidate_id` (from the failed analysis's candidate) and the same `job_profile_id`. The server reads stored CV text from the candidate record — no re-upload required. Navigates to the new analysis URL on success.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Progress stepper shows stage transitions in real-time during analysis
- Completed analysis shows match summary at the top
- Questions are grouped by category with correct labels
- Each question shows rationale and suggested answer
- Empty categories (no findings) are hidden, not shown as "0 findings"
- Error state shows on pipeline failure with descriptive error message
- Retry button creates a new analysis and navigates to it
- Loading state renders cleanly while initial fetch is in-flight
- Page is responsive on mobile viewports

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- **CV parser** (`tests/lib/cv-parser/`): MIME type dispatch, extraction delegation, error handling. Mock `unpdf` and `office-oxide-wasm`.
- **Anonymizer** (`tests/lib/anonymizer/`): Regex patterns (emails, phones, URLs individually), section-aware rules (name/company detection), full pipeline against synthetic CV, placeholder numbering consistency, edge cases (empty input, no PII found).
- **Analysis schema** (`tests/lib/analysis/`): Zod validation of well-formed and malformed responses, category enum values, nullable fields.
- **Prompt builder** (`tests/lib/analysis/`): Output includes CV text, profile data, expected skills; system prompt contains all four categories.

### What's NOT Tested (S-01 scope):

- React components (no jsdom/RTL infrastructure)
- API route integration (would require mocking Supabase + LLM + Workers runtime)
- E2E browser tests

### Manual Testing Steps:

1. Upload a real QA CV (PDF) → see categorized questions within 60s
2. Upload a DOCX file → same result
3. Paste CV text → pipeline runs without file parsing
4. Select different job profiles → questions calibrated to profile
5. Submit with LLM provider down → error state with retry
6. Submit with corrupt PDF → immediate 400 error
7. Check `/dashboard` list → new analysis appears with correct status
8. Log in as different user → cannot see other user's analyses
9. Verify anonymized text sent to LLM (check `raw_response` in DB) contains no emails, phones, or names

## Performance Considerations

- **WASM cold start**: `unpdf` (~700KB) and `office-oxide-wasm` (~2MB) add to Worker bundle. Monitor cold start times on `wrangler dev --remote`. If unacceptable, consider lazy-loading DOCX parser only when a DOCX is uploaded.
- **Pipeline budget**: Text extraction (<1s) + anonymization (<100ms) + LLM (10-25s) + DB writes (~300ms) = ~12-27s, within the 55s timeout.
- **Polling load**: 2-3s polling × 4-5 stages × 1 DB read per poll = ~10-15 lightweight SELECT queries per analysis. Negligible for MVP traffic.
- **Supabase round-trips**: 4 DB writes in background (3 status updates + 1 batch insert) × 20-80ms = 80-320ms overhead. Acceptable.

## Migration Notes

- The schema migration is additive only (new nullable columns). Backward-compatible with the existing codebase — no code depends on the new columns until S-01 code is deployed.
- Deploy migration BEFORE deploying S-01 code. If code deploys first, `pii_map` and `raw_response` writes will fail silently (columns don't exist).
- Rollback: `wrangler rollback` reverts code. The migration columns stay in the DB but are unused — no cleanup needed.

## References

- Research: `context/changes/first-gated-generation/research.md`
- PRD: `context/foundation/prd.md` (US-01, FR-001, FR-002, FR-006, FR-007, FR-008)
- Roadmap: `context/foundation/roadmap.md` (S-01 entry)
- LLM client: `src/lib/llm/client.ts:61-104` — `completeLLM()` implementation
- DB schema: `supabase/migrations/20260527185003_data_schema_and_rls.sql`
- Database types: `src/db/database.types.ts`
- API pattern: `src/pages/api/llm/health.ts` — JSON API convention
- Auth middleware: `src/middleware.ts` — route protection pattern
- Impl-review (F-02): `context/changes/llm-integration-scaffold/reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema Migration + CV Text Extraction Module

#### Automated

- [x] 1.1 Migration applies cleanly — c8a108e
- [x] 1.2 Type regeneration includes new columns — c8a108e
- [x] 1.3 Unit tests pass for CV parser — c8a108e
- [x] 1.4 Lint passes — c8a108e

#### Manual

- [ ] 1.5 PDF text extraction works on Workers (wrangler dev --remote)
- [ ] 1.6 DOCX text extraction works on Workers
- [ ] 1.7 WASM cold start acceptable (< 3s)

### Phase 2: PII Anonymization Module

#### Automated

- [x] 2.1 Unit tests pass for anonymizer pipeline
- [x] 2.2 Unit tests pass for regex patterns
- [x] 2.3 Lint passes

#### Manual

- [x] 2.4 Anonymizer output is readable with clear placeholders on synthetic CV
- [x] 2.5 No structured PII leaks in anonymized text

### Phase 3: Analysis Pipeline — API Routes + LLM Prompt

#### Automated

- [ ] 3.1 Schema unit tests pass
- [ ] 3.2 Prompt builder unit tests pass
- [ ] 3.3 Build succeeds
- [ ] 3.4 Lint passes

#### Manual

- [ ] 3.5 POST /api/analysis returns analysis_id within 2 seconds
- [ ] 3.6 Status endpoint shows stage progression
- [ ] 3.7 Results endpoint returns categorized questions
- [ ] 3.8 No auth → 401 JSON response
- [ ] 3.9 No file or text → 400 JSON response
- [ ] 3.10 LLM timeout → analysis status = 'failed'
- [ ] 3.11 Corrupt file → 400 error returned immediately

### Phase 4: Frontend — Dashboard List + New Analysis Form

#### Automated

- [ ] 4.1 Build succeeds
- [ ] 4.2 Lint passes

#### Manual

- [ ] 4.3 Dashboard shows analysis history list
- [ ] 4.4 New Analysis navigates to form
- [ ] 4.5 File upload accepts PDF/DOCX, rejects others
- [ ] 4.6 Paste fallback accessible via collapse/expand
- [ ] 4.7 Profile dropdown populates with 9 seeded profiles
- [ ] 4.8 Successful submission redirects to results page
- [ ] 4.9 Unauthenticated access redirects to sign-in

### Phase 5: Frontend — Progress Polling + Results Display

#### Automated

- [ ] 5.1 Build succeeds
- [ ] 5.2 Lint passes

#### Manual

- [ ] 5.3 Progress stepper shows real-time stage transitions
- [ ] 5.4 Match summary displays at top of results
- [ ] 5.5 Questions grouped by category with rationale and suggested answers
- [ ] 5.6 Empty categories hidden
- [ ] 5.7 Error state with retry button on pipeline failure
- [ ] 5.8 Retry creates new analysis and navigates to it
- [ ] 5.9 Page responsive on mobile viewports
