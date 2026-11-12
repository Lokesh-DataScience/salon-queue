-- =====================================================================
-- Admin Pages — Slice 0 (foundation)
-- Run on the TESTS project first (vowhxrxavqrrbxdztcnh).
-- Production (phgsbtsfugkipfngbhgs) only after the Slice 0 checkpoint passes.
-- Safe to re-run.
-- =====================================================================

-- 0) Pre-check: salon_staff.id and salons.id must be uuid.
--    Run this alone first; both rows should say "uuid".
-- select table_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and ((table_name = 'salon_staff' and column_name = 'id')
--     or (table_name = 'salons'      and column_name = 'id'));

-- 1) Admin roles — one row per admin account. Only you write this table.
create table if not exists public.staff_admin_roles (
  staff_id   uuid primary key references public.salon_staff(id) on delete cascade,
  role       text not null check (role in ('FOUNDER', 'SALES', 'TECH')),
  granted_at timestamptz not null default now(),
  note       text
);

alter table public.staff_admin_roles enable row level security;
revoke all on table public.staff_admin_roles from anon, authenticated;

-- 2) Internal salons (admin / demo / test accounts) — excluded from metrics.
alter table public.salons
  add column if not exists is_internal boolean not null default false;

-- 3) Audit log for every admin action that changes data.
create table if not exists public.admin_audit_log (
  id             bigint generated always as identity primary key,
  actor_staff_id uuid references public.salon_staff(id) on delete set null,
  actor_role     text not null,
  action         text not null,
  target_type    text,
  target_id      text,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon, authenticated;

-- =====================================================================
-- Verification (expected results in comments)
-- =====================================================================

-- a) Tables exist with RLS on  → 2 rows, rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('staff_admin_roles', 'admin_audit_log');

-- b) is_internal column exists → 1 row, boolean, default false
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'salons' and column_name = 'is_internal';

-- c) Role check works → should FAIL with a check-constraint error
-- insert into public.staff_admin_roles (staff_id, role)
-- values ((select id from public.salon_staff limit 1), 'ADMIN');

-- =====================================================================
-- How to make someone an admin (use later, after backend is in):
-- =====================================================================
-- 1. Find the account:
--    select st.id as staff_id, st.email, s.id as salon_id, s.name
--    from public.salon_staff st join public.salons s on s.id = st.salon_id
--    where st.email = 'partner@example.com';
-- 2. Give the role:
--    insert into public.staff_admin_roles (staff_id, role, note)
--    values ('<staff_id>', 'SALES', 'sales partner');
-- 3. Mark their salon internal:
--    update public.salons set is_internal = true where id = '<salon_id>';
-- To remove access:
--    delete from public.staff_admin_roles where staff_id = '<staff_id>';
