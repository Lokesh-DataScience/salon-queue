-- step21_shop_catalog_verify.sql — run after step21_shop_catalog.sql. Read-only. Every row must say true.
with t(name) as (values ('suppliers'), ('product_categories'), ('products'), ('product_images'),
                        ('shop_settings'), ('inventory_movements')),
f(sig) as (values
  ('shop_require_founder(uuid)'),
  ('shop_save_product(uuid,uuid,jsonb,integer)'),
  ('shop_set_product_visibility(uuid,uuid,boolean)'),
  ('shop_delete_product(uuid,uuid)'),
  ('shop_adjust_stock(uuid,uuid,text,integer,integer,text)'),
  ('shop_stock_check(uuid,jsonb)'),
  ('shop_save_category(uuid,uuid,jsonb)'),
  ('shop_add_product_image(uuid,uuid,text,text)'),
  ('shop_update_product_image(uuid,uuid,uuid,integer,text)'),
  ('shop_delete_product_image(uuid,uuid,uuid)'),
  ('shop_update_settings(uuid,jsonb)'),
  ('shop_update_supplier(uuid,jsonb)'))
select 'all 6 shop tables exist' as check,
       (select count(*) = 6 from information_schema.tables
         where table_schema = 'public' and table_name in (select name from t)) as ok
union all
select 'RLS on for every shop table',
       (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in (select name from t))
union all
select 'no policies on shop tables',
       not exists (select 1 from pg_policies where schemaname = 'public' and tablename in (select name from t))
union all
select 'no anon/authenticated grants on shop tables',
       not exists (select 1 from information_schema.role_table_grants
                    where table_schema = 'public' and table_name in (select name from t)
                      and grantee in ('anon', 'authenticated', 'PUBLIC'))
union all
select 'all 12 shop functions exist',
       (select count(*) = 12 from f where to_regprocedure('public.' || sig) is not null)
union all
select 'anon/authenticated cannot run any shop function',
       (select bool_and(not has_function_privilege('anon', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('authenticated', to_regprocedure('public.' || sig), 'execute'))
          from f)
union all
select 'service_role can run every shop function',
       (select bool_and(has_function_privilege('service_role', to_regprocedure('public.' || sig), 'execute')) from f)
union all
select 'staff reference is ON DELETE RESTRICT',
       exists (select 1 from pg_constraint
                where conname = 'inventory_movements_actor_staff_id_fkey' and confdeltype = 'r')
union all
select 'stock history is append-only (update/delete/truncate triggers)',
       (select count(*) = 2 from pg_trigger
         where tgrelid = 'public.inventory_movements'::regclass and not tgisinternal)
union all
select 'stock columns guarded',
       exists (select 1 from pg_trigger where tgrelid = 'public.products'::regclass and tgname = 'products_guard_stock')
union all
select 'selling price below MRP enforced',
       exists (select 1 from pg_constraint where conname = 'products_price_below_mrp')
union all
select 'exactly one active supplier', (select count(*) = 1 from public.suppliers where is_active)
union all
select 'settings row with default reminders',
       exists (select 1 from public.shop_settings where id and placed_reminder_after_minutes > 0
                 and placed_reminder_repeat_minutes > 0)
union all
select 'starter categories present', (select count(*) >= 5 from public.product_categories)
union all
select 'image bucket: public, 2 MB, images only',
       exists (select 1 from storage.buckets where id = 'shop-product-images' and public
                 and file_size_limit = 2097152
                 and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']);
