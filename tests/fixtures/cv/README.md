# Synthetic CV text fixtures

All strings in this directory are **invented** — no real candidate PII.

## Layout

- `catchable.ts` — PII the anonymizer is expected to remove (email, intl/US phone,
  header Title-Case name, pipe-table company). Used by `tests/lib/anonymizer/boundary.test.ts`.
- `accepted-miss.ts` — PII classes documented as MVP gaps (body-only company,
  single-token name, non-matching phone shape, bare domain, address, dates). Used by
  characterization tests; failures here mean the anonymizer improved.

## Adding fixtures

1. Add a new entry to the appropriate array in `catchable.ts` or `accepted-miss.ts`.
2. For catchable entries, list every raw `piiValues` string the boundary test must not see
   in `buildAnalysisPrompt(anonymizeCV(cv).anonymizedText, profile)`.
3. Keep names, emails, phones, and companies fictional.
