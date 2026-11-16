-- step25_shop_returns_rollback.sql — undo step25. REFUSES once any return or stock decision exists (that
-- history is never deleted: fix forward). Restores the step24b versions of the payment and report functions
-- by asking you to run step24b_shop_money.sql again right after this file.
begin;
do $$
begin
  if to_regclass('public.order_returns') is not null and exists (select 1 from public.order_returns) then
    raise exception 'step25 rollback refused: returns exist. Fix forward instead.';
  end if;
  if exists (select 1 from public.order_items where stock_state in ('CANCEL_RESTOCKED','CANCEL_WRITTEN_OFF','CANCEL_SPLIT')) then
    raise exception 'step25 rollback refused: stock decisions exist. Fix forward instead.';
  end if;
end $$;
drop function if exists public.mark_refund_paid(uuid, uuid, text);
drop function if exists public.resolve_return(uuid, uuid, text, integer, integer, integer, text);
drop function if exists public.record_return(uuid, uuid, uuid, integer, text);
drop function if exists public.shop_dispose_line(uuid, uuid, uuid, integer, integer, text);
drop function if exists public.shop_back_movement(uuid, public.order_items, text, integer, uuid, text);
drop function if exists public.shop_pending_settlement();
drop function if exists public.shop_order_settleable(public.orders);
drop index if exists public.inventory_movements_return_once;
drop index if exists public.inventory_movements_line_once;
create unique index inventory_movements_line_once
  on public.inventory_movements (order_item_id, movement_type) where order_item_id is not null;
alter table public.inventory_movements drop constraint if exists inventory_movements_refs_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_amounts_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_type_check;
alter table public.inventory_movements drop column if exists return_id;
alter table public.inventory_movements add constraint inventory_movements_type_check check (movement_type in (
  'INITIAL_STOCK','STOCK_COUNT','MANUAL_ADJUSTMENT','DAMAGED_STOCK',
  'SUPPLIER_REJECTION','RESERVATION','RELEASE','COMMIT','CANCEL_RESTOCK','CANCEL_WRITE_OFF'));
alter table public.inventory_movements add constraint inventory_movements_amounts_check check (
  case movement_type
    when 'INITIAL_STOCK'      then qty_change > 0 and on_hand_after = on_hand_before + qty_change and reserved_after = reserved_before
    when 'STOCK_COUNT'        then qty_change <> 0 and on_hand_after = on_hand_before + qty_change and reserved_after = reserved_before
    when 'MANUAL_ADJUSTMENT'  then qty_change <> 0 and on_hand_after = on_hand_before + qty_change and reserved_after = reserved_before
    when 'DAMAGED_STOCK'      then qty_change < 0 and on_hand_after = on_hand_before + qty_change and reserved_after = reserved_before
    when 'RESERVATION'        then qty_change > 0 and on_hand_after = on_hand_before and reserved_after = reserved_before + qty_change
    when 'RELEASE'            then qty_change > 0 and on_hand_after = on_hand_before and reserved_after = reserved_before - qty_change
    when 'COMMIT'             then qty_change > 0 and on_hand_after = on_hand_before - qty_change and reserved_after = reserved_before - qty_change
    when 'SUPPLIER_REJECTION' then qty_change > 0 and on_hand_after = on_hand_before - qty_change and reserved_after = reserved_before
    when 'CANCEL_RESTOCK'     then qty_change > 0 and on_hand_after = on_hand_before + qty_change and reserved_after = reserved_before
    when 'CANCEL_WRITE_OFF'   then qty_change > 0 and on_hand_after = on_hand_before and reserved_after = reserved_before
    else false
  end);
alter table public.inventory_movements add constraint inventory_movements_refs_check check (
  case when movement_type in ('INITIAL_STOCK','STOCK_COUNT','MANUAL_ADJUSTMENT','DAMAGED_STOCK')
       then order_id is null and order_item_id is null
       else order_id is not null and order_item_id is not null
  end);
alter table public.order_items drop constraint if exists order_items_returned_qty;
alter table public.order_items drop column if exists returned_qty;
drop table if exists public.order_returns;
drop function if exists public.shop_guard_return();
-- settled_payable_paise stays (harmless); run step24b_shop_money.sql again now to restore its functions.
do $$ begin raise notice 'step25 rolled back — now run step24b_shop_money.sql again'; end $$;
commit;
