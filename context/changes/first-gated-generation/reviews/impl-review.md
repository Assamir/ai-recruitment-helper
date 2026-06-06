<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Gated Generation (S-01)

- **Plan**: context/changes/first-gated-generation/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-06-06
- **Verdict**: REJECTED
- **Findings**: 1 critical  8 warnings  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS (lint clean, 169/169 tests pass; manual checks pending by design) |

## Findings

### F1 — pii_map UPDATE silently no-ops under RLS

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Data safety)
- **Location**: src/pages/api/analysis/index.ts:169 (+ missing RLS policy on `candidates`)
- **Detail**: Background pipeline writes `pii_map` via `candidates.update(...)`, but `candidates` has only SELECT/INSERT/DELETE RLS policies — no UPDATE. The write affects 0 rows; `pii_map` stays NULL. Result is not error-checked, so the pipeline reports success while the audit trail is never persisted. Confirmed by schema grep + tests/rls/candidates-update.rls.test.ts.
- **Fix**: Add an additive UPDATE RLS policy on `candidates` scoped to `user_id = auth.uid()`, and check `{ error }` on the pii_map write so failures are loud.
  - Strength: Restores the audit trail; makes failure observable; matches additive-migration convention.
  - Tradeoff: New migration + redeploy; must stay backward-compatible.
  - Confidence: HIGH — root cause confirmed.
  - Blind spot: Whether any downstream feature assumes pii_map is always null.
- **Decision**: ACCEPTED-AS-RULE: Supabase writes need a matching RLS policy AND an error check (fix deferred)

### F2 — Retry flow not implemented in frontend (plan Phase 5 #6)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/analysis/AnalysisView.tsx:79-84
- **Detail**: Plan specifies a Retry button re-submitting via POST /api/analysis with candidate_id + job_profile_id (no re-upload). API supports it; UI only links to /dashboard/new, forcing full re-upload.
- **Fix A ⭐ Recommended**: Implement planned retry — POST candidate_id + job_profile_id from the failed analysis, navigate to the new id.
  - Strength: Delivers planned UX; API ready.
  - Tradeoff: Need candidate_id + profile_id in the view (extra fetch or SSR prop).
  - Confidence: MED — depends on results endpoint payload.
  - Blind spot: Whether candidate_id is currently exposed to the client.
- **Fix B**: Document link-to-new-analysis as accepted simplification.
  - Strength: Zero new code; functional.
  - Tradeoff: Loses the no-re-upload benefit.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (AnalysisView retries via candidate_id POST; fetches results on terminal status for retry data)

### F3 — Background Supabase writes ignore errors; status can stick

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/analysis/index.ts:165,169,172,202-216
- **Detail**: Every waitUntil() DB call discards its result. JWT expiry / RLS block / network failure leaves status stuck; the catch-block `failed` update can fail the same way. Client polls until 180s timeout with no signal.
- **Fix**: Destructure `{ error }` on each write; throw on non-null so the catch path runs; log/metric if the failure-update itself errors.
- **Decision**: FIXED (setStatus helper throws on status-write errors; questions insert error-checked; terminal failed-update logs via console.error if it also errors; pii_map left best-effort per deferred F1)

### F4 — Unknown/unauthorized analysis IDs render as a live "parsing" job

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security/Reliability)
- **Location**: src/pages/dashboard/[id].astro:14-16
- **Detail**: `initialStatus` falls back to "parsing" when `.data` is null — exactly what RLS-denied/non-existent rows return. Foreign/random UUIDs show a fake live progress UI instead of 404/redirect.
- **Fix**: Check `{ data, error }`; redirect to /dashboard or render not-found when error or !data.
- **Decision**: FIXED ([id].astro now redirects to /dashboard when the analysis row is missing or RLS-denied)

### F5 — Status polling ignores 404/non-OK until the 180s timeout

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/analysis/AnalysisProgress.tsx:38-39
- **Detail**: `if (!res.ok) return;` swallows 401/404; the loop runs MAX_POLLS (60) × 3s = 180s before surfacing a timeout.
- **Fix**: On 401/404, call onFailed immediately with a clear message.
- **Decision**: FIXED (poll loop now fails fast with a clear message on 401/404)

### F6 — Pasted cv_text has no server-side size limit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance/Security)
- **Location**: src/pages/api/analysis/index.ts:84-86,114
- **Detail**: File uploads capped at MAX_CV_FILE_BYTES (5MB), but the paste fallback is accepted with only `.trim().length > 0` and stored wholesale — bypassing the limit and feeding unbounded text to the LLM.
- **Fix**: Apply MAX_CV_FILE_BYTES (or a char cap) to cv_text server-side before insert.
- **Decision**: FIXED (added MAX_CV_TEXT_CHARS = 200,000; paste path returns 400 on overflow)

### F7 — DOCX parser: undocumented lib swap + no uncompressed-size cap

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Security) / Plan Adherence
- **Location**: src/lib/cv-parser/docx.ts:1-2,32-42
- **Detail**: Plan specified `office-oxide-wasm`; implementation uses `fflate` + manual `<w:t>` XML extraction (functional, tests pass — likely the workerd-compat fix in 24934b9). `unzipSync(...)` decompresses the whole archive in memory with no per-entry/total cap (zip-bomb risk). Library substitution undocumented in the plan.
- **Fix**: Enforce a max uncompressed-bytes cap before/within parsing; add a one-line plan addendum noting the fflate substitution.
- **Decision**: FIXED (docx.ts filters to word/document.xml + caps uncompressed size at 20MB before/after inflation; plan addendum added noting fflate substitution)

### F8 — cfContext accessed without guard; POST can strand a "parsing" row

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/analysis/index.ts:159-161
- **Detail**: `context.locals.cfContext.waitUntil(...)` is unguarded. If cfContext is undefined (misconfigured adapter / non-CF harness), a TypeError fires AFTER the analysis row was created as "parsing", leaving a stuck record.
- **Fix**: Guard `if (!context.locals.cfContext?.waitUntil)` → synchronously mark the analysis failed and return 503.
- **Decision**: FIXED (guards cfCtx?.waitUntil; marks analysis failed + returns 503 when absent)

### F9 — useState misused for a mount side-effect in AnalysisView

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/analysis/AnalysisView.tsx:64-68
- **Detail**: `useState(() => { ... fetchResults() })` abuses the lazy state initializer to run a side effect during render; creates an unused state slot and can double-fetch under React 19 Strict Mode.
- **Fix**: Replace with `useEffect(() => { if (initialStatus === "completed") void fetchResults(); }, [initialStatus, fetchResults])`.
- **Decision**: FIXED (resolved as a side effect of F2 — the mount-fetch block was reworked to useEffect)

### F10 — Plan bookkeeping & minor drift (Progress stale; UI trims)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria / Plan Adherence
- **Location**: context/changes/first-gated-generation/plan.md:628-660 et al.
- **Detail**: Phases 4 & 5 SHIPPED (commits bee654d, 1764c68) but their Progress checkboxes are still `[ ]` and change.md status is "implementing". QuestionCard.tsx (plan §Phase 5 #5) inlined into AnalysisResults.tsx:105-129 with no category badge. AnalysisProgress shows 3 stages; planned client-side "Generating" 4th stage absent. Anonymizer never emits [ADDRESS]/[LOCATION_N]; `addresses` count always 0 (findDates unwired). Bookkeeping/drift, not defects; automated checks pass.
- **Fix**: Sync plan Progress + change.md status to reality; decide whether inlined card / 3-stage stepper / address placeholders are accepted scope.
- **Decision**: FIXED (checked Phase 4 & 5 automated Progress boxes with SHAs bee654d/1764c68; change.md already stamped impl_reviewed). Inlined QuestionCard, 3-stage stepper, and missing [ADDRESS]/[LOCATION] placeholders accepted as scope.

---

## Re-review (2026-06-06)

- **Verdict**: APPROVED
- **Verification**: lint 0 errors, typecheck 0 errors, 170/170 tests pass (28 files). All F1–F10 fixes confirmed present in committed code — F1 via migration `20260606130000_candidates_update_rls.sql` (commit fa0a6dd) + error-checked `pii_map` write; F2–F9 via commit 52028c4.
- **Findings**: 0 critical  0 warnings  2 observations (both fixed).

### N1 — GET routes rely on RLS only; DELETE adds explicit user_id guard

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/analysis/[id]/index.ts (GET) + src/pages/api/analysis/[id]/status.ts
- **Detail**: GET full-results and status queries scoped only by `.eq("id", id)`, relying entirely on the SELECT RLS policy, while DELETE adds `.eq("user_id", userId)` defense-in-depth. Safe today; inconsistent.
- **Fix**: Add `.eq("user_id", context.locals.user.id)` to the GET and status queries.
- **Decision**: FIXED (both queries now scope by user_id to match DELETE).

### N2 — suggested_answer typed non-null in AnalysisView, nullable everywhere else

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/analysis/AnalysisView.tsx:10
- **Detail**: AnalysisView's local `Question.suggested_answer` was `string`, while the schema, API payload, and AnalysisResults model it as `string | null`. No runtime bug (guarded downstream), but a type lie.
- **Fix**: Change to `suggested_answer: string | null`.
- **Decision**: FIXED.
