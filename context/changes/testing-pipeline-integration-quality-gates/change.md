---
change_id: testing-pipeline-integration-quality-gates
title: Pipeline integration & quality gates
status: implementing
created: 2026-06-05
updated: 2026-06-05
archived_at: null
---

## Notes

Pipeline integration & quality gates — Phase 4 of the test rollout in
`context/foundation/test-plan.md` (§3 Phased Rollout).

Goal: end-to-end orchestration holds with a mocked LLM; lock the floor in CI.
- Risks covered: #6 (pipeline breaks at an integration boundary / fails silently)
  plus cross-cutting concerns.
- Test types: integration (LLM mocked at the network edge) + quality gates.
- Gates to enforce (§5): pipeline integration (mocked LLM) on PR; recommended
  analysis-latency / error observability via Cloudflare Workers logs/metrics.

## Follow-ups

- **`candidates` UPDATE RLS (pipeline integrity):** gated characterization in
  `tests/rls/candidates-update.rls.test.ts` expects the owning-user `pii_map` UPDATE
  is a silent 0-row no-op under current policies (no UPDATE policy on `candidates`).
  **RLS verdict (2026-06-05, remote `cavihksgicxjjhipmtwv`):** UPDATE blocked — `pii_map`
  stays `null` after update attempt. Fix: additive UPDATE RLS policy migration
  (separate change). RLS lane reads `SUPABASE_URL`/`SUPABASE_KEY` from `.env` via
  `tests/rls/setup.ts`; stable test users provisioned via linked Supabase CLI.
- **Analysis-latency / error observability (recommended):** Cloudflare Workers
  logs/metrics for the ~60s pipeline budget and silent-failure detection — deferred;
  remains a recommended (non-required) gate per test-plan §5.
