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

create table if not exists revoked_tokens (
  jti         text primary key,
  expires_at  timestamptz not null,
  revoked_at  timestamptz not null default now()
);
create index if not exists revoked_tokens_expires_at_idx on revoked_tokens (expires_at);
alter table revoked_tokens enable row level security;


alter table queue_entries add column if not exists push_subscription jsonb;

create index if not exists queue_entries_push_idx
  on queue_entries (status) where push_subscription is not null;

create or replace function cleanup_customer_data(p_retention_hours int)
returns table (cancelled_stale int, anonymized int)
language plpgsql
as $$
declare
  v_cancelled int;
  v_anon int;
begin
  -- 1. Entries stuck active on a past day's queue become CANCELLED.
  update queue_entries e
  set status = 'CANCELLED', cancelled_at = now()
  from queues q
  where e.queue_id = q.id
    and q.date < current_date
    and e.status in ('WAITING', 'CALLED', 'SERVING');
  get diagnostics v_cancelled = row_count;

  -- 2. Push subscriptions are useless once a ticket is finished, and the endpoint
  --    is an identifier, so drop them immediately (no retention window).
  update queue_entries
  set push_subscription = null
  where status in ('COMPLETED', 'SKIPPED', 'CANCELLED')
    and push_subscription is not null;

  -- 3. Null out personal data on finished entries past the window.
  update queue_entries
  set customer_name = null, customer_phone = null
  where status in ('COMPLETED', 'SKIPPED', 'CANCELLED')
    and (customer_name is not null or customer_phone is not null)
    and coalesce(completed_at, skipped_at, cancelled_at)
        < now() - make_interval(hours => p_retention_hours);
  get diagnostics v_anon = row_count;

  return query select v_cancelled, v_anon;
end;
$$;

revoke all on function cleanup_customer_data(int) from public, anon, authenticated;
grant execute on function cleanup_customer_data(int) to service_role;