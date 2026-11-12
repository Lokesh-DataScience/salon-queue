-- =====================================================================
-- Admin Pages — Slice 1: founder_overview()
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
--
-- Same rules as barber_stats():
--   * India time (Asia/Kolkata) for every day / week (Monday) / month boundary
--   * "served" = status COMPLETED, counted on the day it was completed
--   * walk-in   = is_walk_in = true
-- Added for the founder view:
--   * "ticket"  = every queue entry created (QR + walk-in, any status), counted on joined_at
--   * internal salons (is_internal = true) are left out of EVERYTHING
-- Counts only. No names, phones, tokens or per-customer rows.
-- =====================================================================

create or replace function public.founder_overview()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with b as (
  select
    (now() at time zone 'Asia/Kolkata')::date                    as today,
    date_trunc('week',  now() at time zone 'Asia/Kolkata')::date as week_start,
    date_trunc('month', now() at time zone 'Asia/Kolkata')::date as month_start
),
r as (
  select
    today, week_start, month_start,
    today - 29                     as chart_start,   -- 30 days including today
    today - 6                      as active_start,  -- 7 days including today
    least(month_start, today - 29) as from_day
  from b
),
real_salons as (
  select id, created_at
  from salons
  where not coalesce(is_internal, false)
),
e as (
  select
    q.salon_id,
    (en.joined_at at time zone 'Asia/Kolkata')::date as joined_d,
    case
      when en.status = 'COMPLETED' and en.completed_at is not null
      then (en.completed_at at time zone 'Asia/Kolkata')::date
    end                                              as served_d,
    coalesce(en.is_walk_in, false)                   as walk_in
  from queue_entries en
  join queues q       on q.id = en.queue_id
  join real_salons s  on s.id = q.salon_id
  cross join r
  where en.joined_at    >= (r.from_day::timestamp at time zone 'Asia/Kolkata')
     or en.completed_at >= (r.from_day::timestamp at time zone 'Asia/Kolkata')
)
select jsonb_build_object(
  'today',       r.today,
  'week_start',  r.week_start,
  'month_start', r.month_start,

  'salons', jsonb_build_object(
    'total',          (select count(*) from real_salons),
    'new_this_month', (select count(*) from real_salons
                        where (created_at at time zone 'Asia/Kolkata')::date >= r.month_start),
    'active_7d',      (select count(distinct salon_id) from e
                        where joined_d between r.active_start and r.today)
  ),

  'tickets', jsonb_build_object(
    'today',         (select count(*) from e where joined_d = r.today),
    'today_walk_in', (select count(*) from e where joined_d = r.today and walk_in),
    'yesterday',     (select count(*) from e where joined_d = r.today - 1),
    'week',          (select count(*) from e where joined_d between r.week_start and r.today),
    'week_walk_in',  (select count(*) from e where joined_d between r.week_start and r.today and walk_in),
    'month',         (select count(*) from e where joined_d between r.month_start and r.today),
    'month_walk_in', (select count(*) from e where joined_d between r.month_start and r.today and walk_in)
  ),

  'served', jsonb_build_object(
    'today', (select count(*) from e where served_d = r.today),
    'week',  (select count(*) from e where served_d between r.week_start and r.today),
    'month', (select count(*) from e where served_d between r.month_start and r.today)
  ),

  'days', (
    select jsonb_agg(jsonb_build_object(
             'date',    r.chart_start + i,
             'tickets', (select count(*) from e where joined_d = r.chart_start + i),
             'served',  (select count(*) from e where served_d = r.chart_start + i)
           ) order by i)
    from generate_series(0, 29) i
  )
)
from r;
$function$;

-- Only the backend (service role) may call it.
revoke all on function public.founder_overview() from public, anon, authenticated;
grant execute on function public.founder_overview() to service_role;

-- =====================================================================
-- Verification
-- =====================================================================

-- a) It runs and returns 30 days → one row, days_count = 30
select jsonb_array_length(public.founder_overview() -> 'days') as days_count,
       public.founder_overview() -> 'salons'  as salons,
       public.founder_overview() -> 'tickets' as tickets;

-- b) Manual cross-check of "tickets today" (should equal tickets.today above)
select count(*) as tickets_today_manual
from queue_entries en
join queues q on q.id = en.queue_id
join salons s on s.id = q.salon_id
where not coalesce(s.is_internal, false)
  and (en.joined_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;

-- c) Grants → only service_role (plus the owner, postgres) should appear
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'founder_overview';
