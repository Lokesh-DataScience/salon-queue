-- step24b_shop_money_verify.sql — run after step24b. Read-only. Every row must say true.
with f(sig) as (values
  ('record_supplier_settlement(uuid,uuid[],integer,text,text,text,timestamptz)'),
  ('record_order_expense(uuid,uuid,text,integer,text)'),
  ('void_order_expense(uuid,uuid,text)'),
  ('shop_finance_report(date,date)'),
  ('create_recovery_code(uuid,uuid,text)'),
  ('redeem_recovery_code(uuid,uuid,text,text,text)'),
  ('revoke_access_key(uuid,uuid,uuid)'))
select 'all 7 money/recovery functions exist' as check,
       (select bool_and(to_regprocedure('public.' || sig) is not null) from f) as ok
union all
select 'service_role only (anon/authenticated cannot run them)',
       (select bool_and(has_function_privilege('service_role', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('anon', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('authenticated', to_regprocedure('public.' || sig), 'execute')) from f)
union all
select 'settlement and expense tables: RLS on, no anon/authenticated access',
       (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.supplier_settlements'::regclass, 'public.order_expenses'::regclass))
   and not has_table_privilege('anon', 'public.supplier_settlements', 'select')
   and not has_table_privilege('authenticated', 'public.order_expenses', 'select')
union all
select 'an order can only be settled by its own supplier (composite FK)',
       exists (select 1 from pg_constraint where conname = 'orders_supplier_settlement_fk' and contype = 'f'
                 and array_length(conkey, 1) = 2)
union all
select 'staff references are RESTRICT (D19)',
       (select bool_and(confdeltype = 'r') from pg_constraint
         where contype = 'f' and confrelid = 'public.salon_staff'::regclass
           and conrelid in ('public.supplier_settlements'::regclass, 'public.order_expenses'::regclass));
