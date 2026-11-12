-- =====================================================================
-- Admin Pages — Slice 10: bug reports from barbers
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
-- A barber writes what went wrong; the Tech tab reads it and sets a status the barber can see.
-- Stored with the report: which account and salon sent it, the page it was sent from, and the
-- browser/phone description (to reproduce bugs). The form asks people not to type customer details.
-- =====================================================================

create table if not exists public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  staff_id    uuid references public.salon_staff(id) on delete set null,
  salon_id    uuid references public.salons(id) on delete set null,
  kind        text not null default 'bug' check (kind in ('bug', 'idea', 'question')),
  message     text not null check (char_length(message) between 5 and 2000),
  page        text check (char_length(page) <= 200),
  device      text check (char_length(device) <= 300),
  status      text not null default 'new' check (status in ('new', 'investigating', 'fixed', 'wont_fix')),
  tech_note   text not null default '' check (char_length(tech_note) <= 1000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.salon_staff(id) on delete set null
);

create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);
create index if not exists bug_reports_staff_idx on public.bug_reports (staff_id, created_at desc);

alter table public.bug_reports enable row level security;
revoke all on table public.bug_reports from anon, authenticated;

-- Verification → 1 row, rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'bug_reports';
