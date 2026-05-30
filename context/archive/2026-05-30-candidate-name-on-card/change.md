---
change_id: candidate-name-on-card
title: Show candidate first and last name on the analysis card
status: archived
created: 2026-05-30
updated: 2026-05-30
archived_at: 2026-05-30T16:03:00Z
---

## Notes

Roadmap slice S-05 (see `context/foundation/roadmap.md`).

- **Outcome:** user can see the candidate's first and last name displayed on the analysis card in the dashboard view, so each analysis is identifiable at a glance instead of being shown anonymously.
- **PRD refs:** US-01, FR-001
- **Prerequisites:** F-01 (candidate name persisted in the schema), S-01 (analysis card and dashboard view exist)
- **Parallel with:** S-02, S-03, S-04
- **Risk:** Low — surfaces an already-captured field on an existing card. The only sensitivity is that the name is raw PII; it stays on the recruiter-facing dashboard and must never cross into anonymized/exported content (see S-04 confidentiality boundary).
