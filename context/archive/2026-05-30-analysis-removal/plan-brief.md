# Delete a Candidate's Analysis from the Dashboard — Plan Brief

> Full plan: `context/changes/analysis-removal/plan.md`

## What & Why

Recruiters accumulate stale or mistaken analyses on the dashboard with no way to remove them. This change adds a per-user, RLS-authorized delete — surfaced as a button on each dashboard card — that removes the analysis from persistent storage and cleans up the candidate's raw PII when it's no longer referenced. Roadmap slice S-06 (US-01, FR-002).

## Starting Point

Analyses are listed on the dashboard as full-card `<a>` links (`src/pages/dashboard/index.astro`). Deletion is currently impossible at the data layer: `analyses` has no DELETE RLS policy, so any delete silently affects 0 rows. `analysis_questions` cascades from `analyses`, but candidate rows (holding raw `cv_text`/`pii_map`) do not — and one candidate can back multiple analyses via the retry path.

## Desired End State

A delete control on each card confirms via a native dialog, then hard-deletes the analysis (questions cascade) and removes the candidate row only when no other analysis references it. The list refreshes via reload. RLS guarantees a user can only ever delete their own data.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Candidate cleanup | Delete candidate iff no other analysis references it | Honors PII removal while protecting the 1:N retry-shared-candidate case | Plan |
| In-progress deletes | Allowed in any status | Late pipeline writes harmlessly hit 0 rows; lets users clear stuck runs | Plan |
| Confirmation UX | Native `confirm()` | Zero new UI, guards accidental clicks, ships fastest | Plan |
| Control placement | Button on each card (React island) | Matches "delete from the dashboard"; one focused island | Plan |
| Post-delete | Page reload | Simple, guarantees server-truth list, matches existing patterns | Plan |
| Error handling | 401 / 503 / 404 / 200 per route conventions | Consistent; RLS makes not-owned == not-found (privacy) | Plan |
| Testing depth | Unit-tested cleanup helper + manual | Locks the trickiest rule; matches repo's test reality | Plan |

## Scope

**In scope:** DELETE RLS policies (`analyses`, `candidates`); `DELETE /api/analysis/{id}` with conditional candidate cleanup; pure `shouldDeleteCandidate` helper + unit tests; dashboard card delete button with confirm + reload.

**Out of scope:** unconditional candidate deletion; status gating; styled modal; detail-page delete control; optimistic DOM updates; soft-delete/archive; API/integration test harness.

## Architecture / Approach

Bottom-up vertical slice: RLS authorizes the delete → endpoint orchestrates it (read analysis scoped to user → delete analysis → count remaining analyses for the candidate → delete candidate iff zero) → dashboard island triggers it. RLS is the authorization backstop at every step; the server never trusts a client `user_id`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & RLS | DELETE policies on `analyses` + `candidates` | Forgetting the policy → silent 0-row deletes |
| 2. Endpoint + helper | `DELETE` route with conditional candidate cleanup; unit-tested decision | Mis-ordering delete vs. candidate cleanup cascades sibling analyses |
| 3. Card delete UI | Delete button + confirm + reload | Nested interactive element inside the card `<a>` |

**Prerequisites:** F-01 (schema/RLS) and S-01 (analyses listed on dashboard) — both present.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Accidental data loss is the headline risk; mitigated by native confirm + RLS-scoped per-user delete + conditional (not cascading) candidate cleanup.
- Restructuring the card markup must not break navigation to `/dashboard/{id}` or the empty state.
- A non-fatal candidate-cleanup failure leaves an orphaned candidate row; acceptable (analysis is already deleted).

## Success Criteria (Summary)

- A recruiter can delete their own analysis from the dashboard; it disappears from the list and from storage (with its questions).
- The candidate's raw PII is removed when no analysis references it, and retained when a sibling analysis still does.
- No user can delete another user's analysis (404, no change).
