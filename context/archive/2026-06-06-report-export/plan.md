# Report Export (S-04) Implementation Plan

## Overview

Let a recruiter export a **completed** analysis as **Markdown** or **PDF (via printable HTML)**, containing **anonymized content only** plus a mandatory **confidentiality header** (FR-009). This is the deliverable the recruiter hands to the hiring manager. The slice is greenfield within an established pattern set: a new authenticated route, a dependency-free rendering/redaction library, and a client button mirroring the existing delete action.

## Current State Analysis

- **No export endpoint or UI exists.** Report data is already assembled by `GET /api/analysis/:id` (`src/pages/api/analysis/[id]/index.ts:38-52`): `match_summary`, categorized `questions` (`category/question/rationale/suggested_answer`), `profile`, `custom_requirements`, `project_context`, `linkedin_scrape_note`, `created_at`. That query deliberately excludes `cv_text`, `linkedin_text`, `pii_map`, and `raw_response`.
- **The PII boundary is non-uniform** (`src/pages/api/analysis/index.ts:320-337`):
  - **CV-only path:** CV is anonymized before the LLM; a `pii_map` (placeholder→raw) is written to `candidates`. Stored `match_summary`/`questions` already contain placeholders (`[CANDIDATE_NAME]`, `[EMAIL]`, …). Low leak risk.
  - **LinkedIn path:** raw CV + raw LinkedIn are sent to the LLM and **no `pii_map` is written**. Stored output can echo raw names/companies/emails. **High leak risk.** A naïve serialize-and-download would leak PII for these analyses.
- **No non-JSON / download response exists anywhere in `src/`** — no `Content-Disposition`, `application/pdf`, or `text/markdown` precedent. Errors are JSON via `jsonResponse` (`src/lib/api/response.ts:1-6`), shape `{ error, code }`.
- **Rendering deps:** no Markdown or PDF-generation library installed. `BROWSER` binding is declared (`wrangler.jsonc:19-21`) and `@cloudflare/playwright` is present, but `page.pdf()` needs the **Workers Paid plan** — out of scope per decisions below.
- **Reusable anonymizer primitives:** `findEmails/findPhones/findUrls` (`src/lib/anonymizer/patterns.ts:20-51`) return `{match,start,end}` matches and are pure/workerd-safe. `pii_map` is `Record<placeholder, raw>` (`src/lib/anonymizer/types.ts:3`). Candidate name columns `first_name`/`last_name` exist (`20260530120000_candidate_name_columns.sql`).
- **Contract is test-enforced:** `tests/lib/api/analysis-isolation.test.ts:202-246` asserts 401/400/503/404 codes per handler; `tests/helpers/api-context.ts:20-42` builds a synthetic `APIContext` (supports `url` for query params).

### Key Discoveries

- `src/pages/api/analysis/[id]/status.ts:6-43` — closest structural template for the new route (guard order: 401 → 400 → 503 → 404).
- `src/pages/api/analysis/[id]/index.ts:38-52` — the join set to reuse as the report data source; must additionally read `candidates.pii_map/first_name/last_name` to seed redaction.
- `src/components/analysis/DeleteAnalysisButton.tsx:1-66` — client action pattern to mirror (`{ analysisId }`, `fetch`, loading/error state).
- `src/components/analysis/AnalysisView.tsx:151-163` — completed-state render; the export button mounts here (only meaningful when `status === "completed"`).
- `src/lib/anonymizer/patterns.ts:20-51` — email/phone/url scanners reused by the export redactor.

## Desired End State

On a completed analysis page, the recruiter sees **Export Markdown** and **Export PDF** actions. Markdown downloads a `.md` file; PDF opens a print-optimized HTML page that auto-triggers the browser print dialog (save-as-PDF). Both outputs begin with a confidentiality header and contain **only anonymized content** — verified to redact raw candidate PII even for LinkedIn-path analyses. The route is authenticated, ownership-scoped, and rejects non-completed analyses. Redaction and the API contract are covered by automated tests.

## What We're NOT Doing

- **No true server-side PDF** (`BROWSER` binding `page.pdf()`) — deferred; requires Workers Paid plan. PDF = printable HTML + browser "Print to PDF".
- **No new PDF/Markdown npm dependency** — Markdown and HTML are hand-rolled string templates.
- **No schema/migration changes** — redaction is computed at export time; no new `pii_map` is reconstructed or stored for the LinkedIn path.
- **No pipeline changes** to `src/pages/api/analysis/index.ts` (the anonymize-vs-raw branch is untouched).
- **No dashboard-list export action** — export lives only on the per-analysis view this slice. (Optional future enhancement.)
- **No export audit/timestamp write** — export is read-only.

## Implementation Approach

A pure rendering/redaction library (`src/lib/export/`) with zero workerd-risky deps, consumed by a single authenticated route, surfaced by one client component:

1. **Redaction (`src/lib/export/redact.ts`)** — defense-in-depth, two-layer:
   - **Deterministic layer:** replace exact occurrences of known raw values with neutral labels. Sources, when available: `pii_map` *values* (the raw side of placeholder→raw), and stored candidate `first_name`/`last_name` (+ the `"First Last"` combination). Longest-first replacement to avoid partial overlaps.
   - **Pattern layer:** scrub `findEmails`/`findPhones`/`findUrls` matches with category labels.
   - CV-only output already carries placeholders, so it passes through largely untouched; LinkedIn output is scrubbed against seeds + patterns. Residual risk (anonymizer miss on company/name not in seeds) is acknowledged and mitigated by the confidentiality header.
2. **Markdown (`src/lib/export/markdown.ts`)** and **printable HTML (`src/lib/export/html.ts`)** — share one `ExportReport` shape (`types.ts`) and one confidentiality-header string. Both render header → meta (profile/requirements/date, "LinkedIn cross-referenced" note) → match summary → questions grouped by the four categories. Redaction is applied to all free-text fields before templating.
3. **Route (`src/pages/api/analysis/[id]/export.ts`)** — `GET /api/analysis/:id/export?format=md|pdf`, mirroring `status.ts` guards, reusing the `index.ts` joins plus candidate `pii_map/first_name/last_name`. `format=md` → `text/markdown` attachment; `format=pdf` → printable `text/html` (inline, auto-print). Non-completed → `409`. Invalid/missing `format` → `400`. Success uses a new `fileResponse` helper; errors stay on `jsonResponse`.
4. **UI (`src/components/analysis/ExportReportButton.tsx`)** — mirrors `DeleteAnalysisButton`; two actions; Markdown via a programmatic `<a download>` / `window.open`, PDF via `window.open(...&format=pdf)`. Mounted in `AnalysisView`'s completed return.

## Critical Implementation Details

- **Redaction ordering & overlap.** Apply deterministic exact-string replacements **longest-match-first** (e.g. full `"First Last"` before either name token, longer `pii_map` values before shorter), then the pattern layer, to avoid leaving partial PII or double-labeling. Replacement must be global (all occurrences), not first-only.
- **`pii_map` direction.** `pii_map` is `placeholder → raw`. The redactor consumes its **values** (raw strings) as needles; it does not re-emit the original placeholders for the LinkedIn path (which has none) — it substitutes neutral labels (`[REDACTED]` / category labels). For CV-only output the placeholders are already inline and are left as-is.
- **PDF = printable HTML.** `format=pdf` returns `text/html` served **inline** (no `Content-Disposition: attachment`) with print-optimized CSS and a trailing `<script>window.print()</script>`. The document `<title>` is set to the neutral filename so the print dialog suggests it. The browser owns the actual PDF conversion.
- **Filename safety.** Never use `candidates.file_name` (frequently the candidate name). Exports use `analysis-<id>-<YYYY-MM-DD>.{md}` (date = `created_at`, UTC). HTML title uses the same stem.

## Phase 1: Export rendering & redaction core

### Overview

Build the dependency-free library that turns a report object into redacted Markdown and printable HTML, with the confidentiality header. Fully unit-testable without the route or DB.

### Changes Required

#### 1. Export report shape

**File**: `src/lib/export/types.ts` (new)

**Intent**: Define the single `ExportReport` input shape the renderers consume, plus the redaction seed inputs, decoupling the library from the route's DB rows.

**Contract**: Export `interface ExportReport` covering match summary, questions (`category/question/rationale/suggested_answer`), profile name + seniority/description, custom requirements, project context, `hasLinkedin`/scrape note, `createdAt`, and `analysisId`. Export a `RedactionSeed` type (`piiMapValues: string[]`, `candidateNames: string[]`). Reuse `AnalysisCategory` from `src/lib/analysis/schema.ts`.

#### 2. Export-time redaction

**File**: `src/lib/export/redact.ts` (new)

**Intent**: Provide `redactText(text, seed)` (and a small `redactReport(report, seed)` convenience) that removes raw candidate PII from free-text fields — uniformly for both analysis paths, deterministically where seeds exist, with pattern-based scrubbing as backstop.

**Contract**: `redactText(text: string, seed: RedactionSeed): string`. Layer 1: for each non-empty seed string (sorted by descending length, de-duplicated), global-replace exact occurrences with a neutral label (`[REDACTED]`). Layer 2: replace `findEmails`/`findPhones`/`findUrls` matches (`src/lib/anonymizer/patterns.ts`) with `[EMAIL]`/`[PHONE]`/`[URL]`. Empty/whitespace seeds are ignored. Pure function, no I/O.

#### 3. Confidentiality header + Markdown renderer

**File**: `src/lib/export/markdown.ts` (new)

**Intent**: Render an `ExportReport` (post-redaction) to a Markdown string beginning with the FR-009 confidentiality header.

**Contract**: Export `CONFIDENTIALITY_HEADER(now: Date): string` (or constant + timestamp helper) producing: confidential notice + "anonymized candidate analysis" + "do not redistribute" + `Generated <ISO UTC timestamp>`. Export `toMarkdown(report: ExportReport, seed: RedactionSeed, now?: Date): string`: header block, then meta (requirements label mirroring `formatRequirementsLabel` semantics from `AnalysisResults.tsx:46-66`, created date, optional "LinkedIn cross-referenced" line), match summary, and `## <Category>` sections with numbered questions (rationale + suggested answer). All free-text fields passed through `redactText` first.

#### 4. Printable HTML renderer

**File**: `src/lib/export/html.ts` (new)

**Intent**: Render the same report to a self-contained, print-optimized HTML document for the "Print to PDF" path.

**Contract**: Export `toPrintableHtml(report: ExportReport, seed: RedactionSeed, now?: Date): string`: full `<!doctype html>` document, neutral `<title>` (= filename stem), inline `<style>` tuned for print (readable serif/sans, page margins, avoid color-only cues), the confidentiality header, the same report sections as Markdown, and a trailing `<script>window.print()</script>`. All dynamic text HTML-escaped and redaction-applied. No external assets.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Redaction unit tests pass, including: a LinkedIn-style input where a raw candidate name + email appear in `match_summary`/a question and are absent from the redacted output; a CV-only input whose existing `[CANDIDATE_NAME]` placeholders survive unchanged; longest-match-first ordering (full name redacted, no partial leak).
- Markdown snapshot test passes (stable header wording with timestamp injected/frozen, all four category sections, redaction applied).
- All unit tests pass: `npm run test`

#### Manual Verification

- Rendered Markdown reads cleanly and the confidentiality header is prominent at the top.
- Printable HTML, opened in a browser, is legible and prints to a clean PDF.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Export API route

### Overview

Expose the library through one authenticated, ownership-scoped route that fetches report data + redaction seeds, renders the requested format, and returns a download/printable response.

### Changes Required

#### 1. File/download response helper

**File**: `src/lib/api/response.ts`

**Intent**: Add a sibling to `jsonResponse` for non-JSON responses so download/printable headers are set consistently.

**Contract**: `fileResponse(body: string, opts: { contentType: string; filename?: string; disposition?: "attachment" | "inline" }): Response`. When `filename` + `disposition: "attachment"`, set `Content-Disposition: attachment; filename="..."`. Default disposition `inline`. Leaves `jsonResponse` unchanged.

#### 2. Export route

**File**: `src/pages/api/analysis/[id]/export.ts` (new)

**Intent**: Implement `GET /api/analysis/:id/export?format=md|pdf` — auth/ownership guards, completed-state check, data + seed fetch, render, respond.

**Contract**: `export const GET: APIRoute`. Guard order mirrors `status.ts`: no `locals.user` → 401 `UNAUTHORIZED`; missing/`!isUuid(id)` → 400 `BAD_REQUEST`; `createClient` null → 503 `SERVICE_UNAVAILABLE`. Read `format` from `context.url.searchParams`; not `md`/`pdf` (incl. missing) → 400 `BAD_REQUEST`. Query `analyses` (+ joins for questions/profile and `candidates.pii_map,first_name,last_name`) scoped `.eq("user_id", …)`; miss → 404 `NOT_FOUND`. `status !== "completed"` → 409 `ANALYSIS_NOT_COMPLETED`. Build `ExportReport` + `RedactionSeed` (`piiMapValues` = `Object.values(pii_map ?? {})`, `candidateNames` = `[first_name, last_name, "first last"].filter(Boolean)`). `format=md` → `fileResponse(toMarkdown(...), { contentType: "text/markdown; charset=utf-8", filename: "analysis-<id>-<date>.md", disposition: "attachment" })`. `format=pdf` → `fileResponse(toPrintableHtml(...), { contentType: "text/html; charset=utf-8", disposition: "inline" })`. Errors via `jsonResponse`.

#### 3. Route contract tests

**File**: `tests/lib/api/analysis-isolation.test.ts`

**Intent**: Extend the existing isolation suite so the export handler is gated by the same auth/isolation contract, plus export-specific cases.

**Contract**: Add the export `GET` handler to the parametrized 401/400(missing id)/503/404 cases. Add: invalid/missing `format` → 400 `BAD_REQUEST`; non-completed analysis → 409 `ANALYSIS_NOT_COMPLETED`; a completed analysis with `format=md` → 200, `Content-Type: text/markdown…`, `Content-Disposition: attachment`, body contains the confidentiality header and no seeded raw PII. Use `makeApiContext({ url: "http://localhost/api/analysis/<id>/export?format=md", params: { id } })`.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Export route returns 401/400/503/404 per the isolation contract: `npm run test`
- Invalid `format` → 400; non-completed → 409; completed `format=md` → 200 with correct headers and redacted body — all asserted in tests.
- Build passes: `npx astro sync && npm run build`

#### Manual Verification

- `GET /api/analysis/<completed-id>/export?format=md` (authenticated) downloads a `.md` with the header and anonymized content.
- `?format=pdf` renders the printable HTML and the browser print dialog opens.
- A LinkedIn-path completed analysis exports with raw candidate name/email redacted.

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Export UI

### Overview

Surface the two export actions on the completed-analysis view, mirroring the existing client-action pattern.

### Changes Required

#### 1. Export button component

**File**: `src/components/analysis/ExportReportButton.tsx` (new)

**Intent**: Provide the recruiter-facing "Export Markdown" / "Export PDF" actions with loading/error feedback, mirroring `DeleteAnalysisButton`.

**Contract**: Default export, props `{ analysisId: string }`. Two actions. Markdown: trigger a download of `/api/analysis/${analysisId}/export?format=md` (programmatic `<a download>` or `window.open`). PDF: `window.open(`/api/analysis/${analysisId}/export?format=pdf`, "_blank")` so the printable HTML auto-prints. Show transient error text on non-OK responses (parse `{ error }`). Tailwind styling consistent with existing buttons.

#### 2. Mount in the completed view

**File**: `src/components/analysis/AnalysisView.tsx`

**Intent**: Render the export actions only in the completed state, where `analysisId` is already in scope.

**Contract**: In the completed return (around `:151-163`), render `<ExportReportButton analysisId={analysisId} />` adjacent to `<AnalysisResults … />` (e.g. an actions row above/below results). No changes to `AnalysisResults` props required. (Component is a client island under the existing `client:load` mount at `dashboard/[id].astro:34`.)

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- All tests pass: `npm run test`
- Build passes: `npx astro sync && npm run build`

#### Manual Verification

- On a completed analysis, both export actions are visible and absent on in-progress/failed states.
- Clicking "Export Markdown" downloads the `.md`; "Export PDF" opens the print dialog.
- A network/server error surfaces a readable inline message and the buttons re-enable.

**Implementation Note**: Final phase — confirm the end-to-end flow manually.

---

## Testing Strategy

### Unit Tests

- `redactText`: LinkedIn raw-PII leak case (seeded name + pattern email/phone/url removed); CV-only placeholder pass-through; longest-match-first ordering; empty-seed no-op.
- Markdown renderer snapshot: frozen timestamp, all four categories, redaction applied, header present.

### Integration Tests

- Export route in `analysis-isolation.test.ts`: 401/400/503/404 contract, `format` validation (400), non-completed (409), completed `md` success (200 + headers + redacted body).

### Manual Testing Steps

1. Complete a CV-only analysis → export Markdown → confirm header + placeholders, neutral filename.
2. Export PDF → confirm print dialog and legible layout.
3. Complete a LinkedIn cross-referenced analysis → export both formats → confirm no raw candidate name/email/phone/url in output.
4. Attempt export while in-progress (e.g. direct URL) → confirm 409.

## Performance Considerations

Export is a single DB read (reusing existing joins) + pure in-memory string rendering — negligible CPU, well within Worker limits. No browser-render/Paid-plan path. Redaction is linear in report length with a small constant of seed/pattern scans.

## Migration Notes

None — no schema changes. Existing CV-only analyses carry `pii_map`; LinkedIn-path analyses rely on the export-time redactor seeded with stored candidate name + pattern scrubbing.

## References

- Related research: `context/changes/report-export/research.md`
- Route template: `src/pages/api/analysis/[id]/status.ts:6-43`
- Report data query to reuse: `src/pages/api/analysis/[id]/index.ts:38-52`
- PII branch (leak source): `src/pages/api/analysis/index.ts:320-337`
- Anonymizer primitives: `src/lib/anonymizer/patterns.ts:20-51`, `src/lib/anonymizer/types.ts:1-11`
- Client action pattern: `src/components/analysis/DeleteAnalysisButton.tsx:1-66`
- UI hook: `src/components/analysis/AnalysisView.tsx:151-163`
- Contract tests + helper: `tests/lib/api/analysis-isolation.test.ts:202-246`, `tests/helpers/api-context.ts:20-42`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Export rendering & redaction core

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 06eaa70
- [x] 1.2 Linting passes: `npm run lint` — 06eaa70
- [x] 1.3 Redaction unit tests pass (LinkedIn leak case, CV-only placeholder pass-through, longest-match-first ordering) — 06eaa70
- [x] 1.4 Markdown snapshot test passes (frozen timestamp, four categories, redaction applied) — 06eaa70
- [x] 1.5 All unit tests pass: `npm run test` — 06eaa70

#### Manual

- [x] 1.6 Rendered Markdown reads cleanly with prominent confidentiality header — 06eaa70
- [x] 1.7 Printable HTML is legible and prints to a clean PDF — 06eaa70

### Phase 2: Export API route

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 3b006d3
- [x] 2.2 Linting passes: `npm run lint` — 3b006d3
- [x] 2.3 Export route returns 401/400/503/404 per isolation contract — 3b006d3
- [x] 2.4 Invalid `format` → 400, non-completed → 409, completed `md` → 200 with headers + redacted body — 3b006d3
- [x] 2.5 Build passes: `npx astro sync && npm run build` — 3b006d3

#### Manual

- [x] 2.6 Authenticated `?format=md` downloads a `.md` with header + anonymized content — 3b006d3
- [x] 2.7 `?format=pdf` renders printable HTML and opens the print dialog — 3b006d3
- [x] 2.8 LinkedIn-path analysis exports with raw name/email redacted — 3b006d3

### Phase 3: Export UI

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — a65d35c
- [x] 3.2 Linting passes: `npm run lint` — a65d35c
- [x] 3.3 All tests pass: `npm run test` — a65d35c
- [x] 3.4 Build passes: `npx astro sync && npm run build` — a65d35c

#### Manual

- [x] 3.5 Export actions visible only on completed analyses — a65d35c
- [x] 3.6 Markdown downloads; PDF opens print dialog — a65d35c
- [x] 3.7 Server/network error shows readable inline message and re-enables buttons — a65d35c
