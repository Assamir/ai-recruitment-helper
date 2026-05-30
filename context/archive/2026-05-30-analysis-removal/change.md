---
change_id: analysis-removal
title: Delete a candidate's analysis from the dashboard
status: archived
created: 2026-05-30
updated: 2026-05-30
archived_at: 2026-05-30T16:22:40Z
---

## Notes

Roadmap slice S-06 (`context/foundation/roadmap.md`) — "UX Candidate analysis removal".

- **Outcome:** user can delete a candidate's analysis from the dashboard view, removing it from the list and from persistent storage so stale or mistaken analyses can be cleaned up.
- **PRD refs:** US-01, FR-002
- **Prerequisites:** F-01 (analyses table + RLS to authorize deletion), S-01 (analyses exist and are listed on the dashboard)
- **Risk:** Low — a scoped delete on an existing table. The risk is accidental data loss; a confirmation step and RLS-enforced per-user authorization mitigate it.
