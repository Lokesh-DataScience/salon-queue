-- backend/supabase/step20b_align_tests.sql
-- step20b_align_tests.sql — TESTS PROJECT ONLY. Do not run on production.
-- Makes the tests database match production before any shop migration (C0 finding F1/F2).
-- Production already looks like this; this script changes nothing there in intent.
-- Run only after C1 is approved. One transaction: if any statement fails, nothing changes.

begin;

-- F1. Table grants: production has none for anon/authenticated; tests still has full grants on 14 tables.
revoke all on table
  public.lanes, public.news_feeds, public.news_items, public.offer_daily_stock, public.places,
  public.queue_entries, public.queue_entry_services, public.queues, public.revoked_tokens,
  public.salon_offers, public.salon_services, public.salon_staff, public.salons, public.ticket_ratings
from anon, authenticated;

-- F1. Function EXECUTE: production allows only the service role; tests still allows anon/authenticated on 7.
revoke execute on function
  public.create_default_lane(), public.fill_entry_lane(), public.fill_staff_lane(),
  public.lanes_reset_pause_on_activate(), public.rls_auto_enable(),
  public.salon_is_multi_lane(uuid), public.set_updated_at()
from public, anon, authenticated;
grant execute on function
  public.create_default_lane(), public.fill_entry_lane(), public.fill_staff_lane(),
  public.lanes_reset_pause_on_activate(), public.rls_auto_enable(),
  public.salon_is_multi_lane(uuid), public.set_updated_at()
to service_role;

-- F2. queue_entry_services: production has a 1–240 range, ON DELETE SET NULL and a unique index.
alter table public.queue_entry_services
  drop constraint queue_entry_services_duration_minutes_check,
  add constraint queue_entry_services_duration_minutes_check
    check (duration_minutes >= 1 and duration_minutes <= 240);

alter table public.queue_entry_services
  drop constraint queue_entry_services_service_id_fkey,
  add constraint queue_entry_services_service_id_fkey
    foreign key (service_id) references public.salon_services(id) on delete set null;

create unique index if not exists queue_entry_services_uq
  on public.queue_entry_services (queue_entry_id, service_id)
  where service_id is not null;

commit;

-- Verify (should return 0 rows, then 0, then 1):
-- select * from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon','authenticated');
-- select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
-- select indexname from pg_indexes where indexname = 'queue_entry_services_uq';
