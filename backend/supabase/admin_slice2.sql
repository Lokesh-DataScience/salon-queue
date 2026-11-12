-- =====================================================================
-- Admin Pages — Slice 2: founder salon management
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run. Does NOT replace join_queue / add_walk_in: suspension is
-- enforced by a trigger on queue_entries, so every way of creating a ticket is covered.
-- =====================================================================

-- 1) Suspension flag on salons
alter table public.salons add column if not exists is_suspended boolean not null default false;
alter table public.salons add column if not exists suspended_at timestamptz;

-- 2) "Sign this account out everywhere": any login token issued before this moment is refused.
--    Set only by the founder's password reset. Null = no restriction.
alter table public.salon_staff add column if not exists sessions_valid_after timestamptz;

-- 3) No new tickets (QR or walk-in) for a suspended salon.
--    Existing tickets are untouched: this runs on INSERT only.
create or replace function public.block_entries_for_suspended_salon()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if exists (
    select 1
    from queues q
    join salons s on s.id = q.salon_id
    where q.id = new.queue_id and s.is_suspended
  ) then
    raise exception 'SALON_SUSPENDED';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_block_suspended_entries on public.queue_entries;
create trigger trg_block_suspended_entries
  before insert on public.queue_entries
  for each row execute function public.block_entries_for_suspended_salon();

-- =====================================================================
-- Verification
-- =====================================================================

-- a) New columns → 3 rows
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'salons' and column_name in ('is_suspended', 'suspended_at'))
    or (table_name = 'salon_staff' and column_name = 'sessions_valid_after'));

-- b) Trigger exists → 1 row
select tgname from pg_trigger
where tgrelid = 'public.queue_entries'::regclass and tgname = 'trg_block_suspended_entries';

-- c) Nobody is suspended yet → 0
select count(*) as suspended_salons from public.salons where is_suspended;
