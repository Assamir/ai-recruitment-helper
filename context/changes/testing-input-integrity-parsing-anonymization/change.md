---
change_id: testing-input-integrity-parsing-anonymization
title: Input integrity (parsing + anonymization)
status: implemented
created: 2026-06-04
updated: 2026-06-04
archived_at: null
---

## Notes

Phase 2 of the phased test rollout in `context/foundation/test-plan.md` (§3).

Goal: garbage CV text is rejected, not analyzed; no PII crosses the boundary on
real-world formats.

Risks covered:
- #5 — Garbage CV text from `unpdf`/`docx` parsing (empty/scanned PDF, odd
  format) feeds the pipeline silently → analysis looks correct but is built on
  nothing. (hot-spot `src/lib/cv-parser`)
- #3 — Raw PII (name, email, phone, company) survives anonymization and crosses
  the org boundary into the LLM call or the exported report. (hot-spot
  `src/lib/anonymizer`)

Test types: unit (fixture corpus) + integration at the boundary.

Must challenge / ground during `/10x-research`:
- #5: what the parser returns for empty/scanned/odd files; how downstream
  detects "no usable text". Avoid the single-clean-fixture, "no throw" trap.
- #3: the actual boundary call site where anonymized text is handed to the
  LLM / export. Avoid testing the anonymizer in isolation only.
