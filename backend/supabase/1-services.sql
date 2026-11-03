begin;

-- Only needed if you already ran my earlier text[] version; harmless otherwise.
alter table public.salons drop column if exists services;

create table if not exists public.salon_services (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons(id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- No duplicate names among a salon's active services (any letter case).
create unique index if not exists salon_services_active_name_key
  on public.salon_services (salon_id, lower(name)) where deleted_at is null;
create index if not exists salon_services_salon_idx
  on public.salon_services (salon_id) where deleted_at is null;

-- Same lockdown as your other tables: only the backend (service role) touches it.
alter table public.salon_services enable row level security;
revoke all on public.salon_services from anon, authenticated;
grant all on public.salon_services to service_role;

-- New salons start with two default services. Existing salons are not changed.
create or replace function public.seed_default_services()
returns trigger language plpgsql as $$
begin
  insert into public.salon_services (salon_id, name)
  values (new.id, 'hair cutting'), (new.id, 'beard trimming');
  return new;
end;
$$;

drop trigger if exists salons_seed_services on public.salons;
create trigger salons_seed_services
  after insert on public.salons
  for each row execute function public.seed_default_services();

commit;