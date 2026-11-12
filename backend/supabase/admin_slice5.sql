-- =====================================================================
-- Admin Pages — Slice 5: Sales tab — onboarding funnel
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run. No new tables or columns: everything comes from existing data,
-- so salons registered before this slice are included too.
--
-- One row per real (non-internal) salon registered since p_since (null = all time):
--   has_services     any service ever added (deleted ones count: they did the step)
--   first_ticket_at  first queue entry of any kind (walk-in or QR)
--   first_qr_at      first queue entry that was not a walk-in = a customer scanned the QR
--   last_ticket_at   newest queue entry
-- Salon and owner contact only. No customer data.
-- =====================================================================

create or replace function public.sales_onboarding(p_since timestamptz default null)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with real_salons as (
  select s.*
  from salons s
  where not coalesce(s.is_internal, false)
    and (p_since is null or s.created_at >= p_since)
),
tk as (
  select
    q.salon_id,
    min(e.joined_at)                                                as first_at,
    min(e.joined_at) filter (where not coalesce(e.is_walk_in, false)) as first_qr_at,
    max(e.joined_at)                                                as last_at
  from queue_entries e
  join queues q      on q.id = e.queue_id
  join real_salons s on s.id = q.salon_id
  group by q.salon_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id',              s.id,
  'name',            s.name,
  'phone',           s.phone,
  'created_at',      s.created_at,
  'is_suspended',    coalesce(s.is_suspended, false),
  'district',        p.district,
  'state',           p.state,
  'owner_name',      o.name,
  'owner_phone',     o.phone,
  'owner_email',     o.email,
  'has_services',    exists (select 1 from salon_services sv where sv.salon_id = s.id),
  'first_ticket_at', tk.first_at,
  'first_qr_at',     tk.first_qr_at,
  'last_ticket_at',  tk.last_at
) order by s.created_at desc), '[]'::jsonb)
from real_salons s
left join places p on p.id = s.place_id
left join tk       on tk.salon_id = s.id
left join lateral (
  select ss.name, ss.phone, ss.email
  from salon_staff ss
  where ss.salon_id = s.id and ss.role = 'OWNER'
  limit 1
) o on true;
$function$;

revoke all on function public.sales_onboarding(timestamptz) from public, anon, authenticated;
grant execute on function public.sales_onboarding(timestamptz) to service_role;

-- =====================================================================
-- Verification
-- =====================================================================

-- a) Runs; count equals the number of real salons in (b)
select jsonb_array_length(public.sales_onboarding(null)) as salons_listed;

-- b) Manual count
select count(*) as real_salons from salons where not coalesce(is_internal, false);

-- c) Grants → only service_role (plus postgres)
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'sales_onboarding';
