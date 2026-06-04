---
change_id: testing-data-isolation-api-boundary
title: Data isolation & API boundary
status: implemented
created: 2026-06-04
updated: 2026-06-04
archived_at: null
---

## Notes

Phase 3 of the phased test rollout (`context/foundation/test-plan.md` §3).

Goal: cross-user reads are denied; API routes reject untrusted input.

Risks covered:
- #4 — Recruiter A reaches recruiter B's analysis via the API (IDOR / RLS gap): a request for another user's analysis id must return 403/404, not their data. Must challenge "logged in ⇒ authorized" (ownership ≠ authentication). Cheapest layer: integration against the API acting as a second user.
- #7 — API routes accept unvalidated input (oversized file, wrong type, malformed body): oversized / wrong-type / malformed input must be rejected with a clean 4xx. Server must re-validate (client-side validation is not enough). Cheapest layer: integration on API routes.

Test types: integration on API routes (mock only the external HTTP edge; never mock internal modules). Enables the "API / boundary integration" quality gate (§5).

### Accepted gaps / follow-ups

- Magic-byte / extension verification beyond MIME type (Risk #7)
- Zod (or equivalent) request schemas on API routes
- SSR read paths (`dashboard/index.astro`, `[id].astro`) for foreign-id leakage
- `candidates` missing UPDATE RLS (Phase 4 pipeline integrity)
