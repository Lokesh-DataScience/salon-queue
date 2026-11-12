-- =====================================================================
-- Admin Pages — Slice 8: Tech tab — error and sign-in log
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
--
-- What is stored: kind, a short code, the route with ids/tokens replaced (no query string),
-- the HTTP status, and for sign-in problems the staff account id.
-- Never stored: error messages, request bodies, IP addresses, phone numbers, names.
-- Rows older than 14 days are deleted by the cleanup job.
-- =====================================================================

create table if not exists public.app_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text not null check (kind in ('error', 'auth', 'rate_limit')),
  code       text not null check (char_length(code) <= 60),
  route      text check (char_length(route) <= 200),
  status     smallint,
  staff_id   uuid -- sign-in problems only; no foreign key, so the record survives a deleted account
);

create index if not exists app_events_created_at_idx on public.app_events (created_at desc);
create index if not exists app_events_kind_created_idx on public.app_events (kind, created_at desc);

alter table public.app_events enable row level security;
revoke all on table public.app_events from anon, authenticated;

-- Verification → 1 row, rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'app_events';
