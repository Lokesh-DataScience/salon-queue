-- step9_lanes.sql  (Slice F, part 1 of 2: schema)
-- Additive + idempotent. Safe on a live database and safe to re-run.
-- After this runs, every salon has exactly ONE default lane and nothing visibly changes.

begin;

-- ── 1. lanes: one row per barber chair / queue line ─────────────────────────
create table if not exists public.lanes (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons (id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  is_active   boolean not null default true,   -- inactive lane: finishes who it is serving, starts no one new
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lanes_salon_id_idx on public.lanes (salon_id);
-- Exactly one default lane per salon (the lane a single-owner salon uses).
create unique index if not exists lanes_one_default_per_salon
  on public.lanes (salon_id) where is_default;

alter table public.lanes enable row level security;  -- backend (service role) only, like every other table

drop trigger if exists lanes_set_updated_at on public.lanes;
create trigger lanes_set_updated_at
  before update on public.lanes
  for each row execute function set_updated_at();

-- ── 2. Every salon gets a default lane (existing salons now, new salons automatically) ──
insert into public.lanes (salon_id, name, is_default)
select s.id, 'Main', true
from public.salons s
where not exists (select 1 from public.lanes l where l.salon_id = s.id and l.is_default);

create or replace function public.create_default_lane()
returns trigger
language plpgsql
as $$
begin
  insert into public.lanes (salon_id, name, is_default)
  values (new.id, 'Main', true)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists salons_create_default_lane on public.salons;
create trigger salons_create_default_lane
  after insert on public.salons
  for each row execute function public.create_default_lane();

-- ── 3. queue_entries.lane_id ────────────────────────────────────────────────
alter table public.queue_entries add column if not exists lane_id uuid references public.lanes (id);

-- Backfill: every existing entry belongs to its salon's default lane.
update public.queue_entries e
set lane_id = l.id
from public.queues q, public.lanes l
where e.queue_id = q.id
  and l.salon_id = q.salon_id
  and l.is_default
  and e.lane_id is null;

-- Entries created by the existing RPCs (join_queue, add_walk_in) don't know about lanes yet.
-- This trigger puts them in the salon's default lane, so those functions keep working untouched.
create or replace function public.fill_entry_lane()
returns trigger
language plpgsql
as $$
begin
  if new.lane_id is null then
    select l.id into new.lane_id
    from public.queues q
    join public.lanes l on l.salon_id = q.salon_id and l.is_default
    where q.id = new.queue_id;
  end if;
  return new;
end;
$$;

drop trigger if exists queue_entries_fill_lane on public.queue_entries;
create trigger queue_entries_fill_lane
  before insert on public.queue_entries
  for each row execute function public.fill_entry_lane();

alter table public.queue_entries alter column lane_id set not null;

create index if not exists queue_entries_lane_status_idx
  on public.queue_entries (lane_id, status);

-- ── 4. salon_staff: phone, lane ─────────────────────────────────────────────
alter table public.salon_staff add column if not exists phone text;
alter table public.salon_staff add column if not exists lane_id uuid references public.lanes (id);

-- Staff added by an owner log in with their phone number, so email becomes optional.
-- (Postgres allows many NULLs in a UNIQUE column, so existing owners are unaffected.)
alter table public.salon_staff alter column email drop not null;

create unique index if not exists salon_staff_phone_key
  on public.salon_staff (phone) where phone is not null;

do $$ begin
  alter table public.salon_staff
    add constraint salon_staff_phone_format check (phone is null or phone ~ '^\+?[0-9]{7,15}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.salon_staff
    add constraint salon_staff_login_id check (email is not null or phone is not null);
exception when duplicate_object then null; end $$;

-- Existing staff (the owners) work in the default lane.
update public.salon_staff st
set lane_id = l.id
from public.lanes l
where l.salon_id = st.salon_id and l.is_default and st.lane_id is null;

-- New staff without an explicit lane (e.g. register_salon's owner) get the default lane.
create or replace function public.fill_staff_lane()
returns trigger
language plpgsql
as $$
begin
  if new.lane_id is null then
    select l.id into new.lane_id
    from public.lanes l
    where l.salon_id = new.salon_id and l.is_default;
  end if;
  return new;
end;
$$;

drop trigger if exists salon_staff_fill_lane on public.salon_staff;
create trigger salon_staff_fill_lane
  before insert on public.salon_staff
  for each row execute function public.fill_staff_lane();

commit;

notify pgrst, 'reload schema';