---
change_id: report-export
title: Export analysis report as PDF or Markdown
status: impl_reviewed
created: 2026-06-06
updated: 2026-06-06
archived_at: null
---

## Notes

S-04 context/foundation/roadmap.md

**Accepted residual risk (impl-review F5):** LinkedIn-path exports scrub seeded names, `pii_map` values, and email/phone/url patterns only. Company names, schools, and other LLM-echoed entities not in seeds may remain. The confidentiality header mitigates misuse; exports must not be described as "fully anonymized" for external sharing without human review.
