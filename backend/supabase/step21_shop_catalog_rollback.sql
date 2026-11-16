-- step21_shop_catalog_rollback.sql — undoes step21. ONLY for use before real shop data exists.
-- After real products or orders exist: do NOT run this. Fix forward and keep the shop flag off.
--
-- Before running: Supabase Dashboard → Storage → shop-product-images → delete all files, then delete the bucket.
-- (Supabase blocks deleting storage rows from SQL.) This script refuses to run if the bucket still exists.
-- Ends with "step21 rollback OK".

begin;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'shop-product-images') then
    raise exception 'Delete the shop-product-images bucket in Dashboard → Storage first, then run this again.';
  end if;
end $$;

drop function if exists public.shop_update_supplier(uuid, jsonb);
drop function if exists public.shop_update_settings(uuid, jsonb);
drop function if exists public.shop_delete_product_image(uuid, uuid, uuid);
drop function if exists public.shop_update_product_image(uuid, uuid, uuid, integer, text);
drop function if exists public.shop_add_product_image(uuid, uuid, text, text);
drop function if exists public.shop_save_category(uuid, uuid, jsonb);
drop function if exists public.shop_stock_check(uuid, jsonb);
drop function if exists public.shop_adjust_stock(uuid, uuid, text, integer, integer, text);
drop function if exists public.shop_delete_product(uuid, uuid);
drop function if exists public.shop_set_product_visibility(uuid, uuid, boolean);
drop function if exists public.shop_save_product(uuid, uuid, jsonb, integer);
drop function if exists public.shop_apply_stock_change(uuid, public.products, text, integer, text);
drop function if exists public.shop_require_founder(uuid);

-- The append-only triggers would block dropping rows one by one; dropping the table is fine.
drop table if exists public.inventory_movements;
drop table if exists public.product_images;
drop table if exists public.products;
drop table if exists public.product_categories;
drop table if exists public.suppliers;
drop table if exists public.shop_settings;

drop function if exists public.shop_guard_stock_columns();
drop function if exists public.shop_movements_append_only();

do $$ begin raise notice 'step21 rollback OK'; end $$;

commit;
