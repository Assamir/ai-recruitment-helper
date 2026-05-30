-- Add nullable first_name / last_name columns to candidates.
-- Additive only — backward-compatible with existing rows (null by default).
alter table public.candidates
  add column if not exists first_name text,
  add column if not exists last_name  text;
