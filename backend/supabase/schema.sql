-- backend/supabase/schema.sql
-- Salon Virtual Queue — schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query).
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ── Enums ────────────────────────────────────────────────────────────────

do $$ begin
  create type staff_role as enum ('OWNER', 'BARBER', 'MANAGER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type queue_status as enum ('ACTIVE', 'PAUSED', 'CLOSED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type queue_entry_status as enum
    ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'SKIPPED', 'CANCELLED');
exception when duplicate_object then null; end $$;

-- ── Tables ───────────────────────────────────────────────────────────────

create table if not exists salons (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  description              text,
  phone                    text not null,
  address                  text not null,
  latitude                 double precision not null,
  longitude                double precision not null,
  opening_time             text not null, -- "HH:mm"
  closing_time             text not null, -- "HH:mm"
  average_service_minutes  integer not null default 15,
  is_open                  boolean not null default true,
  is_queue_active          boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists salons_lat_lng_idx on salons (latitude, longitude);

create table if not exists salon_staff (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references salons (id) on delete cascade,
  name           text not null,
  email          text not null unique,
  password_hash  text not null,
  role           staff_role not null default 'BARBER',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists salon_staff_salon_id_idx on salon_staff (salon_id);

create table if not exists queues (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references salons (id) on delete cascade,
  date           date not null,
  current_token  integer not null default 0,
  next_token     integer not null default 1,
  status         queue_status not null default 'ACTIVE',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One queue per salon per day.
  unique (salon_id, date)
);

create index if not exists queues_salon_id_idx on queues (salon_id);

create table if not exists queue_entries (
  id              uuid primary key default gen_random_uuid(),
  queue_id        uuid not null references queues (id) on delete cascade,
  token_number    integer not null,
  customer_name   text,
  customer_phone  text,
  -- Opaque, cryptographically random token: the customer's sole
  -- authorization mechanism for tracking/leaving/completing their ticket.
  access_token    text not null unique,
  status          queue_entry_status not null default 'WAITING',
  joined_at       timestamptz not null default now(),
  called_at       timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,

  -- Token numbers must be unique within a queue. Actual atomic generation
  -- is enforced application-side via a Postgres function (Milestone 2).
  unique (queue_id, token_number)
);

create index if not exists queue_entries_queue_id_status_idx
  on queue_entries (queue_id, status);
create index if not exists queue_entries_access_token_idx
  on queue_entries (access_token);

-- ── updated_at auto-touch ────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists salons_set_updated_at on salons;
create trigger salons_set_updated_at
  before update on salons
  for each row execute function set_updated_at();

drop trigger if exists salon_staff_set_updated_at on salon_staff;
create trigger salon_staff_set_updated_at
  before update on salon_staff
  for each row execute function set_updated_at();

drop trigger if exists queues_set_updated_at on queues;
create trigger queues_set_updated_at
  before update on queues
  for each row execute function set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────
-- The frontend never talks to Supabase directly (see spec §6/§20) — only
-- the backend does, using the service role key, which bypasses RLS
-- entirely. Enabling RLS with zero policies means the anon/public key
-- (if it ever leaked or was misused) grants access to nothing.

alter table salons enable row level security;
alter table salon_staff enable row level security;
alter table queues enable row level security;
alter table queue_entries enable row level security;