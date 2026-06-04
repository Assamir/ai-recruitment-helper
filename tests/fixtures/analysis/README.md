# Analysis grounding fixtures

Each JSON file is a `(anonymizedText, profile, response)` triple for
`findUngroundedClaims` in `tests/lib/analysis/faithfulness.ts`.

## Regenerating recorded runs

1. Run a local analysis with LM Studio (or your configured provider).
2. Copy the anonymized CV text from the analysis pipeline input (placeholders only — no raw PII).
3. Copy the job profile (`name`, `description`, `expected_skills`) used for that run.
4. Copy the validated `AnalysisResponse` JSON returned by the model.
5. Save as `recorded-run-N.json` and re-run `npm run test`.

`recorded-run-1.json` was authored to mirror a realistic anonymized LM Studio output; replace it after you capture a fresh local run.
