-- step24b_shop_money_rollback.sql — undo step24b. REFUSES if any settlement or expense exists (money history
-- is never deleted: fix forward instead). Recovery codes already made stay in shop_verification_codes.
begin;
do $$
begin
  if to_regclass('public.supplier_settlements') is not null and exists (select 1 from public.supplier_settlements) then
    raise exception 'step24b rollback refused: settlements exist. Fix forward instead.';
  end if;
  if to_regclass('public.order_expenses') is not null and exists (select 1 from public.order_expenses) then
    raise exception 'step24b rollback refused: expenses exist. Fix forward instead.';
  end if;
  if exists (select 1 from public.shop_customer_events where event_type <> 'details_changed') then
    raise exception 'step24b rollback refused: recovery history exists. Fix forward instead.';
  end if;
end $$;
drop function if exists public.revoke_access_key(uuid, uuid, uuid);
drop function if exists public.redeem_recovery_code(uuid, uuid, text, text, text);
drop function if exists public.create_recovery_code(uuid, uuid, text);
drop function if exists public.shop_finance_report(date, date);
drop function if exists public.void_order_expense(uuid, uuid, text);
drop function if exists public.record_order_expense(uuid, uuid, text, integer, text);
drop function if exists public.record_supplier_settlement(uuid, uuid[], integer, text, text, text, timestamptz);
drop function if exists public.shop_order_payable(uuid);
drop trigger if exists orders_guard_settlement on public.orders;
drop function if exists public.shop_guard_order_settlement();
drop index if exists public.orders_unsettled_idx;
alter table public.orders drop constraint if exists orders_settled_needs_supplier;
alter table public.orders drop constraint if exists orders_supplier_settlement_fk;
alter table public.orders drop column if exists supplier_settlement_id;
drop table if exists public.order_expenses;
drop function if exists public.shop_guard_expense();
drop table if exists public.supplier_settlements;
alter table public.shop_customer_events drop constraint if exists shop_customer_events_event_type_check;
alter table public.shop_customer_events add constraint shop_customer_events_event_type_check check (event_type in ('details_changed'));
do $$ begin raise notice 'step24b rolled back'; end $$;
commit;
