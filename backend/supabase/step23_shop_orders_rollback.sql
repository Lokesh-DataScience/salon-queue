-- step23_shop_orders_rollback.sql — undoes step23 and step22. ONLY before any real order exists.
-- After real orders exist: never run this. Fix forward and keep the shop flag off.
begin;
do $$ begin
  if exists (select 1 from public.orders) then raise exception 'Orders exist: rollback refused. Fix forward instead.'; end if;
end $$;
drop function if exists public.customer_cancel_order(uuid, uuid, text);
drop function if exists public.shop_profile_owns_order(uuid, public.orders);
drop function if exists public.place_order(uuid, uuid, text, jsonb, integer, jsonb, boolean, boolean, jsonb);
drop index if exists public.inventory_movements_line_once;
alter table public.inventory_movements drop constraint if exists inventory_movements_order_item_fkey;
alter table public.inventory_movements drop constraint if exists inventory_movements_refs_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_amounts_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_type_check;
alter table public.inventory_movements drop column if exists order_item_id;
alter table public.inventory_movements drop column if exists order_id;
-- back to step21's product-level rules
alter table public.inventory_movements add constraint inventory_movements_type_check
  check (movement_type in ('INITIAL_STOCK', 'STOCK_COUNT', 'MANUAL_ADJUSTMENT', 'DAMAGED_STOCK'));
alter table public.inventory_movements add constraint inventory_movements_product_level_check check (
  on_hand_after = on_hand_before + qty_change and reserved_after = reserved_before and qty_change <> 0
  and (movement_type <> 'INITIAL_STOCK' or qty_change > 0) and (movement_type <> 'DAMAGED_STOCK' or qty_change < 0));
drop table if exists public.order_events;
drop table if exists public.order_items;
drop table if exists public.orders;
drop function if exists public.shop_guard_order_item();
drop function if exists public.shop_guard_order();
drop sequence if exists public.shop_order_number_seq;
drop table if exists public.shop_verification_codes;
drop table if exists public.shop_profile_customers;
drop table if exists public.shop_access_keys;
drop table if exists public.shop_access_profiles;
drop table if exists public.shop_customers;
do $$ begin raise notice 'step23 + step22 rollback OK'; end $$;
commit;
