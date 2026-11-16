-- step25_shop_returns_verify.sql — run after step25. Read-only. Every row must say true.
with f(sig) as (values
  ('shop_dispose_line(uuid,uuid,uuid,integer,integer,text)'),
  ('record_return(uuid,uuid,uuid,integer,text)'),
  ('resolve_return(uuid,uuid,text,integer,integer,integer,text)'),
  ('mark_refund_paid(uuid,uuid,text)'),
  ('shop_pending_settlement()'))
select 'all 5 return/decision functions exist' as check,
       (select bool_and(to_regprocedure('public.' || sig) is not null) from f) as ok
union all
select 'service_role only (anon/authenticated cannot run them)',
       (select bool_and(has_function_privilege('service_role', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('anon', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('authenticated', to_regprocedure('public.' || sig), 'execute')) from f)
union all
select 'order_returns: RLS on, no anon/authenticated access',
       (select relrowsecurity from pg_class where oid = 'public.order_returns'::regclass)
   and not has_table_privilege('anon', 'public.order_returns', 'select')
   and not has_table_privilege('authenticated', 'public.order_returns', 'select')
union all
select 'a return can''t pair one order with another order''s item (composite FK)',
       exists (select 1 from pg_constraint where conname = 'order_returns_item_fk' and contype = 'f' and array_length(conkey, 1) = 2)
union all
select 'each return processed once; each line decided once (unique indexes)',
       to_regclass('public.inventory_movements_return_once') is not null and to_regclass('public.inventory_movements_line_once') is not null
union all
select 'write-offs never add stock (movement rule)',
       position('WHEN ''RETURN_WRITE_OFF''::text THEN ((qty_change > 0) AND (on_hand_after = on_hand_before)' in
         (select pg_get_constraintdef(oid) from pg_constraint where conname = 'inventory_movements_amounts_check')) > 0
   and position('WHEN ''CANCEL_WRITE_OFF''::text THEN ((qty_change > 0) AND (on_hand_after = on_hand_before)' in
         (select pg_get_constraintdef(oid) from pg_constraint where conname = 'inventory_movements_amounts_check')) > 0
union all
select 'staff references are RESTRICT (D19)',
       (select bool_and(confdeltype = 'r') from pg_constraint
         where contype = 'f' and confrelid = 'public.salon_staff'::regclass and conrelid = 'public.order_returns'::regclass);
