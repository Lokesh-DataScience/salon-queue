begin;

create or replace function public.barber_stats(p_salon_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
with b as (
  select
    (now() at time zone 'Asia/Kolkata')::date                         as today,
    date_trunc('week',  now() at time zone 'Asia/Kolkata')::date      as week_start,
    date_trunc('month', now() at time zone 'Asia/Kolkata')::date      as month_start
),
r as (
  select
    today, week_start, month_start,
    week_start - 7                                                    as prev_week_start,
    week_start - 7 + (today - week_start)                             as prev_week_same_day,
    (month_start - interval '1 month')::date                          as prev_month_start,
    least(
      (month_start - interval '1 month')::date + (today - month_start),
      month_start - 1
    )                                                                 as prev_month_same_day,
    ((month_start + interval '1 month')::date - month_start)          as month_len
  from b
),
served as (
  select
    (e.completed_at at time zone 'Asia/Kolkata')::date as d,
    coalesce(e.is_walk_in, false)                      as walk_in
  from queue_entries e
  join queues q on q.id = e.queue_id
  cross join r
  where q.salon_id = p_salon_id
    and e.status = 'COMPLETED'
    and e.completed_at is not null
    and e.completed_at >= (r.prev_month_start::timestamp at time zone 'Asia/Kolkata')
)
select jsonb_build_object(
  'today', r.today,
  'served_today',      (select count(*) from served where d = r.today),
  'walk_in_today',     (select count(*) from served where d = r.today and walk_in),
  'served_yesterday',  (select count(*) from served where d = r.today - 1),
  'week', jsonb_build_object(
    'start',            r.week_start,
    'total',            (select count(*) from served where d between r.week_start and r.today),
    'walk_in',          (select count(*) from served where d between r.week_start and r.today and walk_in),
    'prev_same_period', (select count(*) from served where d between r.prev_week_start and r.prev_week_same_day),
    'days', (select jsonb_agg(jsonb_build_object(
                'date', r.week_start + i,
                'count', (select count(*) from served s where s.d = r.week_start + i)
             ) order by i)
             from generate_series(0, 6) i)
  ),
  'month', jsonb_build_object(
    'start',            r.month_start,
    'total',            (select count(*) from served where d between r.month_start and r.today),
    'walk_in',          (select count(*) from served where d between r.month_start and r.today and walk_in),
    'prev_same_period', (select count(*) from served where d between r.prev_month_start and r.prev_month_same_day),
    'days', (select jsonb_agg(jsonb_build_object(
                'date', r.month_start + i,
                'count', (select count(*) from served s where s.d = r.month_start + i)
             ) order by i)
             from generate_series(0, r.month_len - 1) i)
  )
)
from r;
$$;

revoke all on function public.barber_stats(uuid) from public, anon, authenticated;
grant execute on function public.barber_stats(uuid) to service_role;

commit;