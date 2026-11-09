-- step13_verify.sql: run after step13_lane_moves.sql. Both rows should say true.
select 'set_staff_active returns integer' as check,
       bool_and(pg_get_function_result(p.oid) = 'integer') as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_staff_active'
union all
select 'only one set_staff_active exists', count(*) = 1
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_staff_active';
