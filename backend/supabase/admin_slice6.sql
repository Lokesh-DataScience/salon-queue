-- =====================================================================
-- Admin Pages — Slice 6: Sales tab — leads tracker
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
-- Leads are salons you are talking to that have not registered yet (shop and owner
-- contact only — never customer data). When a lead registers, it can be linked to its salon.
-- =====================================================================

create table if not exists public.sales_leads (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 120),
  owner_name   text not null default '' check (char_length(owner_name) <= 120),
  phone        text not null default '' check (char_length(phone) <= 20),
  area         text not null default '' check (char_length(area) <= 120),
  address      text not null default '' check (char_length(address) <= 300),
  status       text not null default 'new'
               check (status in ('new', 'contacted', 'demo', 'interested', 'not_interested', 'converted')),
  follow_up_on date,
  notes        text not null default '' check (char_length(notes) <= 2000),
  salon_id     uuid references public.salons(id) on delete set null,
  created_by   uuid references public.salon_staff(id) on delete set null,
  updated_by   uuid references public.salon_staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists sales_leads_follow_up_idx on public.sales_leads (follow_up_on);
create index if not exists sales_leads_phone_idx on public.sales_leads (phone) where phone <> '';

alter table public.sales_leads enable row level security;
revoke all on table public.sales_leads from anon, authenticated;

-- Verification → 1 row, rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'sales_leads';
