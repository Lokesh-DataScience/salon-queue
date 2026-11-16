-- step23_shop_orders_verify.sql — run after step22 + step23. Read-only. Every row must say true.
with t(name) as (values ('shop_customers'), ('shop_access_profiles'), ('shop_access_keys'), ('shop_profile_customers'),
                        ('shop_verification_codes'), ('orders'), ('order_items'), ('order_events')),
f(sig) as (values ('place_order(uuid,uuid,text,jsonb,integer,jsonb,boolean,boolean,jsonb)'),
                  ('customer_cancel_order(uuid,uuid,text)'))
select 'all 8 customer/order tables exist' as check,
       (select count(*) = 8 from information_schema.tables where table_schema = 'public' and table_name in (select name from t)) as ok
union all
select 'RLS on, no policies, no anon/authenticated grants',
       (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in (select name from t))
   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in (select name from t))
   and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
                    and table_name in (select name from t) and grantee in ('anon', 'authenticated', 'PUBLIC'))
union all
select 'checkout + cancel functions: service_role only',
       (select bool_and(to_regprocedure('public.' || sig) is not null
                    and has_function_privilege('service_role', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('anon', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('authenticated', to_regprocedure('public.' || sig), 'execute')) from f)
union all
select 'staff references on new shop tables are RESTRICT (D19)',
       (select bool_and(confdeltype = 'r') from pg_constraint
         where contype = 'f' and confrelid = 'public.salon_staff'::regclass
           and conrelid in ('public.orders'::regclass, 'public.order_events'::regclass,
                            'public.shop_profile_customers'::regclass, 'public.shop_verification_codes'::regclass))
union all
select 'order lines: unique (order_id, id) for composite FKs (D25)',
       exists (select 1 from pg_constraint where conname = 'order_items_order_id_uq')
union all
select 'movement types widened, one movement per line and type',
       exists (select 1 from pg_constraint where conname = 'inventory_movements_amounts_check')
   and exists (select 1 from pg_indexes where indexname = 'inventory_movements_line_once')
union all
select 'order history append-only; orders/lines guarded',
       exists (select 1 from pg_trigger where tgname = 'order_events_no_update')
   and exists (select 1 from pg_trigger where tgname = 'orders_guard')
   and exists (select 1 from pg_trigger where tgname = 'order_items_guard')
union all
select 'PLACED index for the reminder job (D27)', exists (select 1 from pg_indexes where indexname = 'orders_placed_idx')
union all
select 'order numbers start at SQ-1001 or later',
       (select last_value >= 1001 from public.shop_order_number_seq);
