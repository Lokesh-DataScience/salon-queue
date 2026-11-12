-- =====================================================================
-- Admin Pages — Slice 7: Tech tab — health panel
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
-- One row per background job (sweeper, cleanup, news) plus the uptime pinger.
-- Successful runs are written at most once a minute; failures straight away.
-- Error codes only — never messages (they can contain row data).
-- =====================================================================

create table if not exists public.job_heartbeats (
  name              text primary key,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  last_failure_code text,
  last_detail       jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);

alter table public.job_heartbeats enable row level security;
revoke all on table public.job_heartbeats from anon, authenticated;

-- Verification → 1 row, rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'job_heartbeats';
