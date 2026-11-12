-- =====================================================================
-- Admin Pages — Slice 9b: push delivery numbers
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
-- One row per day (India time) counting what the push services answered:
--   sent     accepted by Google/Apple/Mozilla for delivery
--   expired  the phone's subscription is gone (unsubscribed, browser reset): 404/410
--   failed   any other error; last_failure_code keeps the latest HTTP status only
-- Counts only — no subscription endpoints, tokens or customer data.
-- =====================================================================

create table if not exists public.push_daily (
  day               date primary key,
  sent              integer not null default 0,
  expired           integer not null default 0,
  failed            integer not null default 0,
  last_failure_code text,
  updated_at        timestamptz not null default now()
);

alter table public.push_daily enable row level security;
revoke all on table public.push_daily from anon, authenticated;

-- Atomic +1, so pushes sent at the same moment never lose a count.
create or replace function public.bump_push_stat(p_kind text, p_code text default null)
returns void
language sql
set search_path to 'public'
as $function$
  insert into push_daily (day, sent, expired, failed, last_failure_code, updated_at)
  values (
    (now() at time zone 'Asia/Kolkata')::date,
    (p_kind = 'sent')::int,
    (p_kind = 'expired')::int,
    (p_kind = 'failed')::int,
    case when p_kind = 'failed' then left(p_code, 40) end,
    now()
  )
  on conflict (day) do update set
    sent              = push_daily.sent    + excluded.sent,
    expired           = push_daily.expired + excluded.expired,
    failed            = push_daily.failed  + excluded.failed,
    last_failure_code = coalesce(excluded.last_failure_code, push_daily.last_failure_code),
    updated_at        = now();
$function$;

revoke all on function public.bump_push_stat(text, text) from public, anon, authenticated;
grant execute on function public.bump_push_stat(text, text) to service_role;

-- Verification → 1 row with rowsecurity = true; then the function exists
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'push_daily';
select proname from pg_proc where proname = 'bump_push_stat';
