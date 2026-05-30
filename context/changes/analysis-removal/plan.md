# Delete a Candidate's Analysis from the Dashboard Implementation Plan

## Overview

Let a recruiter delete an analysis directly from the dashboard list. The delete is authorized per-user via RLS, removes the analysis row (its `analysis_questions` cascade away automatically), and cleans up the candidate's raw PII (`cv_text`, `pii_map`) **only when no other analysis still references that candidate**. A delete button on each dashboard card triggers a native confirmation, then a `DELETE /api/analysis/{id}` call, then a page reload. Roadmap slice S-06; PRD refs US-01, FR-002.

## Current State Analysis

- **No DELETE is authorized today.** `analyses` RLS has SELECT / INSERT / UPDATE policies only (`supabase/migrations/20260527185003_data_schema_and_rls.sql:146-160`). The table-level `delete` grant exists for `authenticated` (line 110), but with RLS enabled and no DELETE policy, a delete matches **0 rows** silently. A DELETE policy with `(select auth.uid()) = user_id` both enables the delete and enforces per-user authorization.
- **Questions cascade for free.** `analysis_questions.analysis_id → analyses (id) on delete cascade` (`...20260527185003...:49-51`). Deleting an analysis removes its questions automatically.
- **Candidate rows do not cascade from analysis deletion.** The FK is `analyses.candidate_id → candidates (id) on delete cascade` (`:38`) — deleting a *candidate* cascades to analyses, not the reverse. Deleting an analysis leaves its `candidates` row (holding raw `cv_text` and `pii_map`) in storage. `candidates` RLS has SELECT + INSERT only (`:136-144`), no DELETE policy.
- **Candidate ↔ analysis is 1:N.** The retry path reuses an existing `candidate_id` to create a new analysis (`src/pages/api/analysis/index.ts:42-61`, `:80-91`), so one candidate can back multiple analyses. Unconditionally deleting the candidate would cascade-delete sibling analyses — must be avoided.
- **Dashboard cards are inline Astro `<a>` links** wrapping the entire card and navigating to `/dashboard/{id}` (`src/pages/dashboard/index.astro:102-116`). There is no client island on this page. A delete button cannot simply be nested inside the `<a>` (nested interactive elements / the click would also navigate).
- **API route conventions.** `src/pages/api/analysis/[id]/index.ts` currently exports only `GET`. It uses `context.locals.user` (401 `UNAUTHORIZED`), `createClient(...)` null-check (503 `SERVICE_UNAVAILABLE`), `jsonResponse` (`src/lib/api/response.ts`), and 404 `NOT_FOUND` on missing rows.
- **Client fetch pattern.** `AnalysisForm.tsx` uses `fetch("/api/analysis", { method, body })`, parses `res.ok` / `json.error`, and navigates with `window.location` on success — the pattern the card island should mirror.
- **Tests** live under `tests/lib/**` (Vitest); there is no API/integration harness.

## Desired End State

On the dashboard, each analysis card shows a delete control. Clicking it asks for confirmation; on confirm, the analysis is deleted from storage along with its questions, and the candidate row is deleted only if it has no remaining analyses. The list then reflects the removal (page reload). A user can never delete another user's analysis (RLS denies it; the API returns 404). Deleting an in-progress analysis is allowed — any late writes from its background pipeline harmlessly affect 0 rows.

### Key Discoveries:

- A DELETE RLS policy on `analyses` is mandatory; without it the delete silently no-ops (`...20260527185003...:146-160`).
- `analysis_questions` already cascades on analysis delete (`:49-51`) — no manual question cleanup needed.
- Conditional candidate cleanup needs a DELETE policy on `candidates` plus a "remaining analyses == 0" check (the 1:N retry relationship makes unconditional candidate deletion unsafe).
- Migrations must be additive/backward-compatible per `AGENTS.md`; adding policies is additive. `npx astro sync` must run before `npm run build`.
- The card `<a>` must be restructured so the delete button is a sibling (not a descendant) of the navigating link.

## What We're NOT Doing

- **Not** unconditionally deleting the candidate — only when it has no remaining analyses (protects the retry-shared-candidate case).
- **Not** gating delete by status — in-progress analyses are deletable.
- **Not** adding a styled confirmation modal — native `confirm()` only.
- **Not** adding a delete control on the analysis detail page (`/dashboard/{id}`) — dashboard card only.
- **Not** optimistically mutating the DOM — success triggers a page reload.
- **Not** building an API/integration test harness — only a pure unit-tested decision helper plus manual verification.
- **Not** soft-deleting / archiving — this is a hard delete from persistent storage.
- **Not** deleting `job_profiles` (shared, seeded reference data).

## Implementation Approach

Bottom-up vertical slice: RLS (authorize the delete) → endpoint + cleanup helper (perform the delete and conditional candidate cleanup server-side) → dashboard UI (trigger it). The endpoint owns the ordering: verify ownership by reading the analysis (scoped to the user), capture its `candidate_id`, delete the analysis, then count the candidate's remaining analyses and delete the candidate iff zero remain. RLS is the authorization backstop at every step; the API never trusts a client-supplied `user_id`.

## Critical Implementation Details

- **Cascade direction asymmetry:** deleting an analysis removes its `analysis_questions` (cascade) but never its candidate. Candidate cleanup is an explicit, conditional second step — not a cascade.
- **1:N retry hazard:** because the retry path reuses `candidate_id`, the candidate delete must be guarded by a "no remaining analyses for this candidate" count taken *after* the analysis delete. Deleting the candidate first (or unconditionally) would cascade-delete sibling analyses.
- **RLS-as-authorization:** a not-owned analysis is invisible to the user's `select`/`delete` under RLS, so "not found" and "not yours" are intentionally indistinguishable (404 for both). Scope every query in the endpoint with `.eq("user_id", userId)` belt-and-suspenders even though RLS already enforces it.
- **In-progress deletes:** the background pipeline in `POST /api/analysis` issues `update(...).eq("id", analysisId)` calls; after deletion those match 0 rows and are harmless. No coordination needed.

## Phase 1: Schema & RLS

### Overview

Add the DELETE authorization that does not exist today: a per-user DELETE policy on `analyses`, and a per-user DELETE policy on `candidates` to permit the conditional cleanup.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_analysis_delete_rls.sql` (14-digit timestamp matching the existing convention, e.g. `20260530xxxxxx`)

**Intent**: Authorize per-user deletion of analyses and candidates so the delete endpoint can remove rows (RLS currently denies all deletes). Additive-only.

**Contract**: Two policies, mirroring the existing per-user predicate used by the SELECT/UPDATE policies:

- `analyses` DELETE: `create policy "Users delete own analyses" on public.analyses for delete to authenticated using ( (select auth.uid()) = user_id );`
- `candidates` DELETE: `create policy "Users delete own candidates" on public.candidates for delete to authenticated using ( (select auth.uid()) = user_id );`

No table/column changes; the `delete` grants already exist (`...20260527185003...:107-111`). `analysis_questions` needs no policy — its rows are removed by the FK cascade, not by a direct delete.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase (`supabase db reset` or migration up)
- `npx astro sync && npm run build` passes
- `npm run lint` passes

#### Manual Verification:

- The two DELETE policies exist on `analyses` and `candidates` (verify in Supabase)
- A direct `delete from analyses where id = '<own row>'` as the owning user removes the row and its `analysis_questions`; the same delete for another user's row affects 0 rows

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before starting Phase 2.

---

## Phase 2: Delete endpoint + candidate-cleanup helper

### Overview

Add a `DELETE` handler to the existing `[id]` analysis route and a small pure helper that encodes the "delete candidate iff it has no remaining analyses" decision, covered by unit tests.

### Changes Required:

#### 1. Candidate-cleanup decision helper

**File**: `src/lib/analysis/candidate-cleanup.ts` (new)

**Intent**: Isolate the cleanup decision rule into a pure, unit-testable function, keeping the DB-query orchestration in the route thin.

**Contract**: Export `shouldDeleteCandidate(remainingAnalysisCount: number): boolean` returning `true` iff `remainingAnalysisCount === 0`. Pure; no DB access.

#### 2. DELETE handler on the analysis route

**File**: `src/pages/api/analysis/[id]/index.ts`

**Intent**: Add a `DELETE` export beside `GET` that deletes the user's analysis and conditionally cleans up its candidate, following the route's existing auth/DB/response conventions.

**Contract**: New `export const DELETE: APIRoute`. Sequence:

1. Guard: no `context.locals.user` → 401 `{ error, code: "UNAUTHORIZED" }`; missing `id` param → 400 `BAD_REQUEST`; `createClient(...)` null → 503 `SERVICE_UNAVAILABLE`.
2. Read the analysis scoped to the user: `select("id, candidate_id").eq("id", id).eq("user_id", userId).single()`. On error/no row → 404 `NOT_FOUND` (covers not-owned via RLS). Capture `candidate_id`.
3. Delete the analysis: `delete().eq("id", id).eq("user_id", userId)`. On DB error → 500 `DB_ERROR`. (Questions cascade.)
4. Count the candidate's remaining analyses: `select("id", { count: "exact", head: true }).eq("candidate_id", candidateId).eq("user_id", userId)`. If `shouldDeleteCandidate(count ?? 0)`, `delete()` the candidate (`.eq("id", candidateId).eq("user_id", userId)`). A failure to delete the candidate is non-fatal to the request (the analysis is already gone) — return success but it may be logged.
5. Return 200 `{ success: true }` via `jsonResponse`.

Delete is permitted regardless of analysis status.

### Success Criteria:

#### Automated Verification:

- Unit tests for `shouldDeleteCandidate`: `0 → true`, `1 → false`, `>1 → false` (`npm run test`)
- `npm run lint` passes
- `npx astro sync && npm run build` passes

#### Manual Verification:

- `DELETE /api/analysis/{own-id}` returns 200; the analysis row and its `analysis_questions` are gone
- The candidate row is deleted when it had only that analysis; the candidate row survives when another analysis still references it (set up via the retry path)
- `DELETE` for another user's analysis returns 404 and changes nothing
- `DELETE` without a session returns 401; with the DB unconfigured returns 503
- Deleting an in-progress analysis returns 200 and the background pipeline produces no errors that surface to the user

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before starting Phase 3.

---

## Phase 3: Dashboard card delete UI

### Overview

Surface a delete control on each dashboard card. Because the card is a full-card `<a>`, restructure it so the delete button is a sibling of the link, then wire confirm → DELETE → reload via a small React island.

### Changes Required:

#### 1. Delete-button island

**File**: `src/components/analysis/DeleteAnalysisButton.tsx` (new)

**Intent**: A focused client component that confirms and performs the delete for one analysis, mirroring the fetch/error pattern in `AnalysisForm.tsx`.

**Contract**: Props `{ analysisId: string }`. Renders a small delete button (theme-consistent, e.g. a trash/✕ affordance). On click: `if (!window.confirm("Delete this analysis? This cannot be undone.")) return;`, then `fetch(`/api/analysis/${analysisId}`, { method: "DELETE" })`. On `res.ok` → `window.location.reload()`. On failure → surface a brief inline error and re-enable the button; disable the button while the request is in flight.

#### 2. Card restructure + mount the island

**File**: `src/pages/dashboard/index.astro`

**Intent**: Add the delete control to each card without nesting an interactive button inside the navigating `<a>`.

**Contract**: Wrap each card in a relatively-positioned container holding two siblings: the existing `<a href={/dashboard/${a.id}}>` (the card body/link) and `<DeleteAnalysisButton analysisId={a.id} client:visible />` positioned in the card's action area (e.g. top-right). The `<a>` must no longer contain the button. Import the component in the frontmatter. Keep the empty-state and existing card content/markup otherwise unchanged.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run build` passes (island + page compile)
- `npm run lint` passes

#### Manual Verification:

- Each card shows a delete control; clicking the card body still navigates to `/dashboard/{id}` (button click does not navigate)
- Cancelling the `confirm()` leaves the analysis intact; confirming removes the card after reload
- Deleting the last analysis shows the empty state
- A failed delete (e.g. simulated) surfaces an inline error and the card remains

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks.

---

## Testing Strategy

### Unit Tests:

- `shouldDeleteCandidate`: `0 → true`, `1 → false`, `2 → false`.

### Integration Tests:

- None added (no harness exists). The endpoint and RLS behavior are covered by the Phase 1/2 manual verification steps.

### Manual Testing Steps:

1. As user A, create an analysis, let it complete, then delete it from the dashboard → card disappears after reload; the `analyses`, its `analysis_questions`, and the candidate row are all gone.
2. Trigger the retry path so two analyses share one candidate; delete one → that analysis is gone, the candidate and the sibling analysis remain. Delete the second → candidate now removed too.
3. As user B, attempt `DELETE /api/analysis/{A's id}` → 404, A's data unchanged.
4. Start an analysis and delete it mid-pipeline → 200, no user-facing errors.
5. Cancel the confirmation dialog → nothing is deleted.

## Performance Considerations

Each delete is at most three lightweight, indexed queries (read analysis, delete analysis, count + optional candidate delete) against existing indexes (`analyses` PK, `analyses_candidate_id_idx`). Negligible.

## Migration Notes

Adding RLS policies is additive and backward-compatible per `AGENTS.md`. `wrangler rollback` of the Worker stays safe: the new policies simply go unused by older code. No data is migrated or backfilled.

## References

- Change identity: `context/changes/analysis-removal/change.md`
- Roadmap slice S-06: `context/foundation/roadmap.md:155-165`
- Existing RLS policies: `supabase/migrations/20260527185003_data_schema_and_rls.sql:146-178`
- Cascade FKs: `supabase/migrations/20260527185003_data_schema_and_rls.sql:35-58`
- Analysis route (GET, add DELETE): `src/pages/api/analysis/[id]/index.ts`
- Retry/candidate-reuse path: `src/pages/api/analysis/index.ts:42-91`
- Dashboard card: `src/pages/dashboard/index.astro:87-117`
- Client fetch pattern: `src/components/analysis/AnalysisForm.tsx:38-62`
- Response helper: `src/lib/api/response.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & RLS

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — cebf8b2
- [x] 1.2 `npx astro sync && npm run build` passes — cebf8b2
- [x] 1.3 `npm run lint` passes — cebf8b2

#### Manual

- [x] 1.4 DELETE policies exist on `analyses` and `candidates` — cebf8b2
- [x] 1.5 Owner delete removes row + cascades questions; non-owner delete affects 0 rows — cebf8b2

### Phase 2: Delete endpoint + candidate-cleanup helper

#### Automated

- [x] 2.1 Unit tests for `shouldDeleteCandidate` (0→true, 1→false, >1→false) — d4a13e2
- [x] 2.2 `npm run lint` passes — d4a13e2
- [x] 2.3 `npx astro sync && npm run build` passes — d4a13e2

#### Manual

- [x] 2.4 DELETE own analysis → 200, analysis + questions gone — d4a13e2
- [x] 2.5 Candidate deleted only when no other analysis references it (retry-path check) — d4a13e2
- [x] 2.6 DELETE another user's analysis → 404, no change — d4a13e2
- [x] 2.7 401 without session; 503 with DB unconfigured — d4a13e2
- [x] 2.8 Deleting an in-progress analysis → 200, no surfaced pipeline errors — d4a13e2

### Phase 3: Dashboard card delete UI

#### Automated

- [x] 3.1 `npx astro sync && npm run build` passes — 3900e96
- [x] 3.2 `npm run lint` passes — 3900e96

#### Manual

- [x] 3.3 Delete control present; card body still navigates, button click does not — 3900e96
- [x] 3.4 Cancel confirm → intact; confirm → card removed after reload — 3900e96
- [x] 3.5 Deleting the last analysis shows the empty state — 3900e96
- [x] 3.6 Failed delete surfaces an inline error and keeps the card — 3900e96
