-- =============================================================================
-- S-01: Schema extensions — pii_map on candidates, raw_response on analyses
-- Additive-only migration: new nullable columns with no default values set.
-- Safe to deploy before S-01 code; existing rows carry NULL for both columns.
-- =============================================================================

alter table public.candidates
  add column if not exists pii_map jsonb;

alter table public.analyses
  add column if not exists raw_response text;
