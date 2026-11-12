-- =====================================================================
-- Admin Pages: Cofounder role
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run.
--
-- COFOUNDER sees every admin page (Founder, Sales, Tech) and can use the Sales and
-- Tech tools, but cannot change salons or the team: no adding, suspending, marking
-- internal, password resets, deleting, or giving/removing admin access.
-- =====================================================================

-- Replace the role scheck (whatever its name) with one that allows COFOUNDER.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'staff_admin_roles' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.staff_admin_roles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.staff_admin_roles
  add constraint staff_admin_roles_role_check
  check (role in ('FOUNDER', 'COFOUNDER', 'SALES', 'TECH'));

-- Verification → one row, listing all four roles
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.staff_admin_roles'::regclass and contype = 'c';

-- Giving Cofounder access: easiest from the app (Founder → Team → Give admin access → Cofounder).
-- Or by hand:
-- insert into public.staff_admin_roles (staff_id, role, note)
-- values ('<their salon_staff id>', 'COFOUNDER', 'cofounder')
-- on conflict (staff_id) do update set role = excluded.role;
