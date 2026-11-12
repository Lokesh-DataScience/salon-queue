-- =====================================================================
-- Admin Pages — Slice 11: feature flags (testing tools need no SQL)
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run: existing flags keep their current setting.
--
-- A flag only does something once the app's code reads it. New flags are added here (SQL),
-- then switched on/off from Tech → Tools & flags without a redeploy.
-- =====================================================================

create table if not exists public.feature_flags (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled     boolean not null default false,
  value       text not null default '' check (char_length(value) <= 200),
  description text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.salon_staff(id) on delete set null
);

alter table public.feature_flags enable row level security;
revoke all on table public.feature_flags from anon, authenticated;

insert into public.feature_flags (key, enabled, value, description) values
  ('barber_notice', false, '',
   'Shows a notice bar at the top of every barber screen, e.g. "Maintenance tonight 11 pm to 11:30 pm". The text is the value.'),
  ('bug_reports', true, '',
   'Shows "Report a problem" in barber Settings. Turn off to hide it.')
on conflict (key) do nothing;

-- Verification → 2 rows
select key, enabled, value from public.feature_flags order by key;
