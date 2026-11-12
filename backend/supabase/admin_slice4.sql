-- =====================================================================
-- Admin Pages — Slice 4: Sales tab — salon activity
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
--
-- Rules (India time):
--   * internal salons are left out
--   * "last ticket"   = newest queue entry of any kind (QR or walk-in)
--   * tickets_7d      = entries created today and the 6 days before
--   * churn risk      = registered 3+ days ago AND no ticket today or in the 2 days before
--                       (includes salons that never had a ticket)
--   * area            = the district/state saved at registration (places table)
-- Salon and owner contact only. No customer data.
-- =====================================================================

-- 1) Sales-only info, kept apart from the salons table
create table if not exists public.salon_sales_info (
  salon_id   uuid primary key references public.salons(id) on delete cascade,
  is_partner boolean not null default false,
  notes      text not null default '' check (char_length(notes) <= 2000),
  updated_by uuid references public.salon_staff(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.salon_sales_info enable row level security;
revoke all on table public.salon_sales_info from anon, authenticated;

-- 2) One call returns the whole Sales list
create or replace function public.sales_salon_activity()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with r as (
  select
    (now() at time zone 'Asia/Kolkata')::date                    as today,
    date_trunc('month', now() at time zone 'Asia/Kolkata')::date as month_start
),
real_salons as (
  select s.* from salons s where not coalesce(s.is_internal, false)
),
st as (
  select
    q.salon_id,
    max(e.joined_at) as last_at,
    count(*) filter (where (e.joined_at at time zone 'Asia/Kolkata')::date >= r.today - 6)        as t7,
    count(*) filter (where (e.joined_at at time zone 'Asia/Kolkata')::date >= r.month_start)      as tm
  from queue_entries e
  join queues q       on q.id = e.queue_id
  join real_salons s  on s.id = q.salon_id
  cross join r
  group by q.salon_id
)
select jsonb_build_object(
  'today', r.today,
  'salons', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',                     s.id,
      'name',                   s.name,
      'phone',                  s.phone,
      'address',                s.address,
      'created_at',             s.created_at,
      'is_suspended',           coalesce(s.is_suspended, false),
      'district',               p.district,
      'state',                  p.state,
      'owner_name',             o.name,
      'owner_email',            o.email,
      'owner_phone',            o.phone,
      'last_ticket_at',         st.last_at,
      'days_since_last_ticket', case when st.last_at is null then null
                                     else r.today - (st.last_at at time zone 'Asia/Kolkata')::date end,
      'tickets_7d',             coalesce(st.t7, 0),
      'tickets_month',          coalesce(st.tm, 0),
      'churn_risk',             (s.created_at at time zone 'Asia/Kolkata')::date <= r.today - 3
                                and (st.last_at is null
                                     or (st.last_at at time zone 'Asia/Kolkata')::date <= r.today - 3),
      'is_partner',             coalesce(i.is_partner, false),
      'notes',                  coalesce(i.notes, ''),
      'info_updated_at',        i.updated_at
    ))
    from real_salons s
    left join places p           on p.id = s.place_id
    left join st                 on st.salon_id = s.id
    left join salon_sales_info i on i.salon_id = s.id
    left join lateral (
      select ss.name, ss.email, ss.phone
      from salon_staff ss
      where ss.salon_id = s.id and ss.role = 'OWNER'
      limit 1
    ) o on true
  ), '[]'::jsonb)
)
from r;
$function$;

revoke all on function public.sales_salon_activity() from public, anon, authenticated;
grant execute on function public.sales_salon_activity() to service_role;

-- =====================================================================
-- Verification
-- =====================================================================

-- a) Runs; salon count should equal the number of real (non-internal) salons in (b)
select jsonb_array_length(public.sales_salon_activity() -> 'salons') as salons_listed;

-- b) Manual count
select count(*) as real_salons from salons where not coalesce(is_internal, false);

-- c) Grants → only service_role (plus postgres)
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'sales_salon_activity';
