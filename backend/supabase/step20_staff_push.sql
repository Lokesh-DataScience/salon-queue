-- backend/supabase/step20_staff_push.sql
-- Barber notifications, Slice 1: "New token" alerts on the barber's phone (Web Push).
-- Run on the TESTS project first, with NOTHING highlighted in the editor. Ends with "step20 OK".
-- Production: run this whole file BEFORE deploying the matching backend. Safe to run twice.
--
-- One row per barber device. The endpoint is unique: if a shared phone signs in as another
-- staff member, the row moves to that person instead of alerting both.

begin;

create table if not exists public.staff_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.salon_staff (id) on delete cascade,
  salon_id      uuid not null references public.salons (id) on delete cascade,
  endpoint      text not null unique,
  subscription  jsonb not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists staff_push_subscriptions_salon_idx on public.staff_push_subscriptions (salon_id);
create index if not exists staff_push_subscriptions_staff_idx on public.staff_push_subscriptions (staff_id);

-- Backend only (service role). RLS on with no policies = the public keys can read nothing.
alter table public.staff_push_subscriptions enable row level security;
revoke all on table public.staff_push_subscriptions from anon, authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'staff_push_subscriptions') then
    raise exception 'step20 check failed: table missing. Run the WHOLE file with nothing selected.';
  end if;
  -- The backend sends only to ACTIVE staff, so this column must exist.
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'salon_staff' and column_name = 'is_active') then
    raise exception 'step20 check failed: salon_staff.is_active not found. Tell Claude the column name used for active staff.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'queue_entries' and column_name = 'is_walk_in') then
    raise exception 'step20 check failed: queue_entries.is_walk_in not found.';
  end if;
  raise notice 'step20 OK';
end $$;

commit;

-- Check: should return 0 rows (no grants for anon / authenticated)
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_name = 'staff_push_subscriptions' and grantee in ('anon', 'authenticated');
