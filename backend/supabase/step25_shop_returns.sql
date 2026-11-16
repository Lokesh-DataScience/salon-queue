-- backend/supabase/step25_shop_returns.sql — Commerce Phase 1, C6: stock decisions for cancelled goods, returns
-- and refunds (§7.4, §13). Needs step21–step24b. Run on the TESTS project first, with NOTHING highlighted.
-- Ends with "step25 OK". Then run step25_shop_returns_verify.sql. Production: BEFORE deploying C6. Safe to run twice.
--
-- The supplier takes back UNOPENED items (any time — the founder only chooses "back to supplier" when he did).
--   back to supplier  stock goes up again (CANCEL_RESTOCK / RETURN_RESTOCK) and the supplier is NOT paid for them
--   written off       opened, damaged or not taken back: no stock change; the supplier IS paid; it is a loss
--  shop_dispose_line       a cancelled order's confirmed/collected line: back to supplier / written off / split
--  record_return           goods a customer gave back after DELIVERED (many partial returns per line)
--  resolve_return          back to supplier / written off + refund amount (checked against 3 ceilings), or reject
--  mark_refund_paid        the cash/UPI refund was actually handed over (a separate step, §7.2)
--  shop_order_payable      now: confirmed rate × units the founder keeps (sold, lost or written off)
--  shop_pending_settlement every order the supplier is owed for: delivered, or cancelled with write-offs
--  record_supplier_settlement / shop_finance_report  updated for the above (+ "supplier owes you back")
-- Lock order: products (ascending id) → orders → order_items → order_returns.

begin;

-- ── Returns ──────────────────────────────────────────────────────────────
create table if not exists public.order_returns (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null,
  order_item_id   uuid not null,
  quantity        integer not null check (quantity > 0),
  status          text not null default 'RECEIVED' check (status in ('RECEIVED', 'RESOLVED', 'REJECTED')),
  restock_qty     integer not null default 0 check (restock_qty >= 0),
  write_off_qty   integer not null default 0 check (write_off_qty >= 0),
  reason          text not null default '' check (char_length(reason) <= 300),         -- why the customer returned it
  condition_note  text not null default '' check (char_length(condition_note) <= 300), -- the founder's decision note
  refund_paise    integer not null default 0 check (refund_paise >= 0),
  refund_status   text not null default 'NONE' check (refund_status in ('NONE', 'PENDING', 'PAID')),
  refund_method   text check (refund_method in ('CASH', 'UPI', 'OTHER')),
  refund_paid_at  timestamptz,
  refund_paid_by  uuid references public.salon_staff (id) on delete restrict,
  recorded_by     uuid not null references public.salon_staff (id) on delete restrict,
  resolved_by     uuid references public.salon_staff (id) on delete restrict,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- a return can never pair one order with another order's item (§4.9)
  constraint order_returns_item_fk foreign key (order_id, order_item_id)
    references public.order_items (order_id, id) on delete restrict,
  constraint order_returns_quantities check (case status
    when 'RESOLVED' then restock_qty + write_off_qty = quantity
    else restock_qty = 0 and write_off_qty = 0 end),
  constraint order_returns_refund check (
    (refund_status = 'NONE' and refund_paise = 0)
    or (refund_status in ('PENDING', 'PAID') and refund_paise > 0 and status = 'RESOLVED')),
  constraint order_returns_paid check (
    (refund_status = 'PAID') = (refund_paid_at is not null and refund_paid_by is not null and refund_method is not null)),
  constraint order_returns_resolved check ((status = 'RECEIVED') = (resolved_at is null and resolved_by is null))
);
alter table public.order_returns enable row level security;
revoke all on public.order_returns from anon, authenticated;
create index if not exists order_returns_order_idx on public.order_returns (order_id);
create index if not exists order_returns_open_idx on public.order_returns (order_id)
  where status = 'RECEIVED' or refund_status = 'PENDING';

-- Decided once; a refund goes PENDING → PAID once; the facts of the return never change; no deletes.
create or replace function public.shop_guard_return() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'SHOP_HISTORY_IMMUTABLE'; end if;
  if new.order_id is distinct from old.order_id or new.order_item_id is distinct from old.order_item_id
     or new.quantity is distinct from old.quantity or new.reason is distinct from old.reason
     or new.recorded_by is distinct from old.recorded_by or new.created_at is distinct from old.created_at
     or (old.status <> 'RECEIVED' and (new.status is distinct from old.status or new.restock_qty is distinct from old.restock_qty
          or new.write_off_qty is distinct from old.write_off_qty or new.refund_paise is distinct from old.refund_paise
          or new.condition_note is distinct from old.condition_note or new.resolved_at is distinct from old.resolved_at))
     or (new.refund_status is distinct from old.refund_status and not (
          (old.refund_status = 'NONE' and new.refund_status = 'PENDING' and old.status = 'RECEIVED')
          or (old.refund_status = 'PENDING' and new.refund_status = 'PAID')))
     or (old.refund_status = 'PAID' and (new.refund_paid_at is distinct from old.refund_paid_at or new.refund_method is distinct from old.refund_method))
  then
    raise exception 'SHOP_HISTORY_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists order_returns_guard on public.order_returns;
create trigger order_returns_guard before update or delete on public.order_returns
  for each row execute function public.shop_guard_return();
drop trigger if exists order_returns_set_updated_at on public.order_returns;
create trigger order_returns_set_updated_at before update on public.order_returns
  for each row execute function public.set_updated_at();

-- Units currently given back (received or resolved; a rejected return went back to the customer).
alter table public.order_items add column if not exists returned_qty integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_returned_qty') then
    alter table public.order_items add constraint order_items_returned_qty check (returned_qty between 0 and quantity);
  end if;
end $$;

-- ── Movements: return types ──────────────────────────────────────────────
alter table public.inventory_movements add column if not exists return_id uuid references public.order_returns (id) on delete restrict;
alter table public.inventory_movements drop constraint if exists inventory_movements_type_check;
alter table public.inventory_movements add constraint inventory_movements_type_check check (movement_type in (
  'INITIAL_STOCK','STOCK_COUNT','MANUAL_ADJUSTMENT','DAMAGED_STOCK',
  'SUPPLIER_REJECTION','RESERVATION','RELEASE','COMMIT','CANCEL_RESTOCK','CANCEL_WRITE_OFF',
  'RETURN_RESTOCK','RETURN_WRITE_OFF'));
alter table public.inventory_movements drop constraint if exists inventory_movements_amounts_check;
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
    when 'RETURN_RESTOCK'     then qty_change > 0 and on_hand_after = on_hand_before + qty_change and reserved_after = reserved_before
    when 'RETURN_WRITE_OFF'   then qty_change > 0 and on_hand_after = on_hand_before and reserved_after = reserved_before  -- a loss, never stock
    else false
  end);
alter table public.inventory_movements drop constraint if exists inventory_movements_refs_check;
alter table public.inventory_movements add constraint inventory_movements_refs_check check (
  case
    when movement_type in ('INITIAL_STOCK','STOCK_COUNT','MANUAL_ADJUSTMENT','DAMAGED_STOCK')
      then order_id is null and order_item_id is null and return_id is null
    when movement_type in ('RETURN_RESTOCK','RETURN_WRITE_OFF')
      then order_id is not null and order_item_id is not null and return_id is not null
    else order_id is not null and order_item_id is not null and return_id is null
  end);
-- one reservation / release / commit / disposition per line; many returns per line, each processed once (§7.6)
drop index if exists public.inventory_movements_line_once;
create unique index inventory_movements_line_once
  on public.inventory_movements (order_item_id, movement_type) where order_item_id is not null and return_id is null;
create unique index if not exists inventory_movements_return_once
  on public.inventory_movements (return_id, movement_type) where return_id is not null;

-- ── What the supplier is owed ────────────────────────────────────────────
-- Settled orders remember what they added up to when paid, so a later "back to supplier" shows as money he
-- owes back (the founder takes it off the next payment, with a note).
alter table public.orders add column if not exists settled_payable_paise integer check (settled_payable_paise >= 0);

create or replace function public.shop_guard_order_settlement() returns trigger
language plpgsql set search_path = public as $$
begin
  if (old.supplier_settlement_id is not null and new.supplier_settlement_id is distinct from old.supplier_settlement_id)
     or (old.settled_payable_paise is not null and new.settled_payable_paise is distinct from old.settled_payable_paise) then
    raise exception 'SHOP_ALREADY_SETTLED';
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_settlement on public.orders;
create trigger orders_guard_settlement before update of supplier_settlement_id, settled_payable_paise on public.orders
  for each row execute function public.shop_guard_order_settlement();

-- Confirmed rate × the units the founder keeps: committed lines minus what went back to the supplier.
-- RESERVED / RELEASED lines never left the supplier: 0.
create or replace function public.shop_order_payable(p_order_id uuid) returns integer
language sql stable set search_path = public as $$
  select coalesce(sum(
           coalesce(i.confirmed_unit_cost_paise, i.expected_unit_cost_paise)
           * (i.quantity - i.cancel_restock_qty
              - coalesce((select sum(r.restock_qty) from public.order_returns r
                           where r.order_item_id = i.id and r.status = 'RESOLVED'), 0))), 0)::integer
    from public.order_items i
   where i.order_id = p_order_id
     and i.stock_state in ('COMMITTED', 'AWAITING_DISPOSITION', 'CANCEL_RESTOCKED', 'CANCEL_WRITTEN_OFF', 'CANCEL_SPLIT')
$$;

update public.orders set settled_payable_paise = public.shop_order_payable(id)
 where supplier_settlement_id is not null and settled_payable_paise is null;

-- Orders the supplier can be paid for now: delivered, or cancelled with every line decided and something kept.
create or replace function public.shop_order_settleable(o public.orders) returns boolean
language sql stable set search_path = public as $$
  select o.supplier_settlement_id is null and o.supplier_id is not null and (
    o.status = 'DELIVERED'
    or (o.status = 'CANCELLED'
        and not exists (select 1 from public.order_items i where i.order_id = o.id and i.stock_state = 'AWAITING_DISPOSITION')
        and public.shop_order_payable(o.id) > 0))
$$;

create or replace function public.shop_pending_settlement() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_number', o.order_number, 'status', o.status, 'delivered_at', o.delivered_at,
           'updated_at', o.updated_at, 'total_paise', o.total_paise, 'supplier_id', o.supplier_id,
           'supplier_name', s.name, 'payable_paise', public.shop_order_payable(o.id))
         order by coalesce(o.delivered_at, o.updated_at)), '[]'::jsonb)
    from public.orders o left join public.suppliers s on s.id = o.supplier_id
   where o.status in ('DELIVERED', 'CANCELLED') and public.shop_order_settleable(o)
$$;

create or replace function public.record_supplier_settlement(
  p_actor uuid, p_order_ids uuid[], p_amount_paise integer, p_method text, p_reference text, p_note text,
  p_paid_at timestamptz default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_ids uuid[];
  v_supplier uuid;
  v_payable integer := 0;
  v_o public.orders;
  v_id uuid;
  v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  perform public.shop_require_founder(p_actor);
  if p_order_ids is null or cardinality(p_order_ids) = 0 or cardinality(p_order_ids) > 200 then raise exception 'SHOP_INVALID_INPUT'; end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_order_ids) x;
  if cardinality(v_ids) <> cardinality(p_order_ids) then raise exception 'SHOP_DUPLICATE_ORDERS'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'SHOP_INVALID_QTY'; end if;
  if p_method is null or p_method not in ('CASH', 'UPI', 'BANK', 'OTHER') then raise exception 'SHOP_INVALID_INPUT'; end if;
  if p_paid_at is not null and p_paid_at > now() + interval '5 minutes' then raise exception 'SHOP_INVALID_INPUT'; end if;

  for v_o in select * from public.orders where id = any (v_ids) order by id for update loop
    if not public.shop_order_settleable(v_o) then raise exception 'SHOP_NOT_SETTLEABLE'; end if;
    if v_supplier is null then v_supplier := v_o.supplier_id;
    elsif v_supplier <> v_o.supplier_id then raise exception 'SHOP_MIXED_SUPPLIERS';
    end if;
    v_payable := v_payable + public.shop_order_payable(v_o.id);
  end loop;
  if (select count(*) from public.orders where id = any (v_ids)) <> cardinality(v_ids) then raise exception 'SHOP_NOT_FOUND'; end if;
  if p_amount_paise <> v_payable and char_length(v_note) < 3 then raise exception 'SHOP_MISMATCH_NOTE_REQUIRED'; end if;

  insert into public.supplier_settlements (supplier_id, paid_at, amount_paise, payable_paise, order_count, method, reference, note, recorded_by)
  values (v_supplier, coalesce(p_paid_at, now()), p_amount_paise, v_payable, cardinality(v_ids), p_method,
          left(btrim(coalesce(p_reference, '')), 100), v_note, p_actor)
  returning id into v_id;
  update public.orders set supplier_settlement_id = v_id, settled_payable_paise = public.shop_order_payable(id)
   where id = any (v_ids) and supplier_settlement_id is null;
  if (select count(*) from public.orders where supplier_settlement_id = v_id) <> cardinality(v_ids) then
    raise exception 'SHOP_NOT_SETTLEABLE';
  end if;
  insert into public.order_events (order_id, event_type, to_value, customer_visible, actor_type, actor_staff_id)
  select x, 'supplier_settled', v_id::text, false, 'STAFF', p_actor from unnest(v_ids) x;
  return jsonb_build_object('settlement_id', v_id, 'payable_paise', v_payable, 'order_count', cardinality(v_ids));
end $$;

-- ── Internal: one return/disposition stock movement (caller holds the locks) ──
create or replace function public.shop_back_movement(
  p_actor uuid, p_item public.order_items, p_type text, p_qty integer, p_return_id uuid, p_reason text
) returns void
language plpgsql set search_path = public as $$
declare
  v_p public.products;
  v_on integer;
begin
  if p_qty <= 0 then return; end if;
  select * into v_p from public.products where id = p_item.product_id;
  if not found then return; end if;  -- product hard-deleted: nothing to move
  v_on := v_p.stock_on_hand + case when p_type in ('CANCEL_RESTOCK', 'RETURN_RESTOCK') then p_qty else 0 end;
  if v_on <> v_p.stock_on_hand then
    perform set_config('shop.stock_write', 'on', true);
    update public.products set stock_on_hand = v_on where id = v_p.id;
    perform set_config('shop.stock_write', 'off', true);
  end if;
  insert into public.inventory_movements (product_id, movement_type, qty_change, on_hand_before, on_hand_after,
    reserved_before, reserved_after, reason, actor_type, actor_staff_id, order_id, order_item_id, return_id)
  values (v_p.id, p_type, p_qty, v_p.stock_on_hand, v_on, v_p.stock_reserved, v_p.stock_reserved,
    left(coalesce(p_reason, ''), 300), 'STAFF', p_actor, p_item.order_id, p_item.id, p_return_id);
end $$;

-- ── Cancelled goods: the stock decision (§13.1) ─────────────────────────
create or replace function public.shop_dispose_line(
  p_actor uuid, p_order_id uuid, p_item_id uuid, p_restock_qty integer, p_write_off_qty integer, p_note text
) returns void
language plpgsql set search_path = public as $$
declare
  v_order public.orders;
  v_item public.order_items;
  v_state text;
  v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  perform public.shop_require_founder(p_actor);
  perform 1 from public.products where id = (select product_id from public.order_items where id = p_item_id and order_id = p_order_id) for update;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  select * into v_item from public.order_items where id = p_item_id and order_id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if v_order.status <> 'CANCELLED' or v_item.stock_state <> 'AWAITING_DISPOSITION' then raise exception 'SHOP_STALE'; end if;
  if p_restock_qty is null or p_write_off_qty is null or p_restock_qty < 0 or p_write_off_qty < 0
     or p_restock_qty + p_write_off_qty <> v_item.quantity then
    raise exception 'SHOP_DISPOSITION_QTY';
  end if;
  v_state := case when p_write_off_qty = 0 then 'CANCEL_RESTOCKED' when p_restock_qty = 0 then 'CANCEL_WRITTEN_OFF' else 'CANCEL_SPLIT' end;

  update public.order_items set stock_state = v_state, cancel_restock_qty = p_restock_qty, cancel_write_off_qty = p_write_off_qty
   where id = v_item.id;
  perform public.shop_back_movement(p_actor, v_item, 'CANCEL_RESTOCK', p_restock_qty, null, 'Back to supplier ' || v_order.order_number);
  perform public.shop_back_movement(p_actor, v_item, 'CANCEL_WRITE_OFF', p_write_off_qty, null, 'Written off ' || v_order.order_number);
  insert into public.order_events (order_id, event_type, from_value, to_value, customer_visible, note, actor_type, actor_staff_id)
  values (p_order_id, 'stock_decision', p_restock_qty::text, p_write_off_qty::text, false, v_note, 'STAFF', p_actor);
end $$;

-- ── Returns after delivery (§13.2) ───────────────────────────────────────
create or replace function public.record_return(
  p_actor uuid, p_order_id uuid, p_item_id uuid, p_qty integer, p_reason text
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_order public.orders;
  v_item public.order_items;
  v_id uuid;
begin
  perform public.shop_require_founder(p_actor);
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  select * into v_item from public.order_items where id = p_item_id and order_id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if v_order.status <> 'DELIVERED' then raise exception 'SHOP_STALE'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'SHOP_INVALID_QTY'; end if;
  if v_item.returned_qty + p_qty > v_item.quantity then raise exception 'SHOP_RETURN_TOO_MANY'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'SHOP_REASON_REQUIRED'; end if;

  insert into public.order_returns (order_id, order_item_id, quantity, reason, recorded_by)
  values (p_order_id, p_item_id, p_qty, left(btrim(p_reason), 300), p_actor)
  returning id into v_id;
  update public.order_items set returned_qty = returned_qty + p_qty where id = p_item_id;
  insert into public.order_events (order_id, event_type, to_value, customer_visible, note, actor_type, actor_staff_id)
  values (p_order_id, 'return_received', p_qty::text, true, v_item.product_name, 'STAFF', p_actor);
  return v_id;
end $$;

-- p_decision RESOLVED: restock + write-off = quantity; refund ≤ (1) the returned units' price, (2) what is left
-- of the line's total after its other refunds, (3) the cash collected minus every other refund on the order.
-- p_decision REJECTED: nothing back, no refund; the goods went back to the customer (note required).
create or replace function public.resolve_return(
  p_actor uuid, p_return_id uuid, p_decision text, p_restock_qty integer, p_write_off_qty integer,
  p_refund_paise integer, p_note text
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_r public.order_returns;
  v_order public.orders;
  v_item public.order_items;
  v_note text := left(btrim(coalesce(p_note, '')), 300);
  v_refund integer := coalesce(p_refund_paise, 0);
begin
  perform public.shop_require_founder(p_actor);
  select * into v_r from public.order_returns where id = p_return_id;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  perform 1 from public.products where id = (select product_id from public.order_items where id = v_r.order_item_id) for update;
  select * into v_order from public.orders where id = v_r.order_id for update;
  select * into v_item from public.order_items where id = v_r.order_item_id for update;
  select * into v_r from public.order_returns where id = p_return_id for update;
  if v_r.status <> 'RECEIVED' then raise exception 'SHOP_STALE'; end if;

  if p_decision = 'REJECTED' then
    if char_length(v_note) < 3 then raise exception 'SHOP_REASON_REQUIRED'; end if;
    update public.order_returns set status = 'REJECTED', condition_note = v_note, resolved_by = p_actor, resolved_at = now()
     where id = p_return_id;
    update public.order_items set returned_qty = returned_qty - v_r.quantity where id = v_item.id;
    insert into public.order_events (order_id, event_type, to_value, customer_visible, note, actor_type, actor_staff_id)
    values (v_order.id, 'return_rejected', v_r.quantity::text, true, v_note, 'STAFF', p_actor);
    return v_order.id;
  elsif p_decision <> 'RESOLVED' then
    raise exception 'SHOP_INVALID_INPUT';
  end if;

  if p_restock_qty is null or p_write_off_qty is null or p_restock_qty < 0 or p_write_off_qty < 0
     or p_restock_qty + p_write_off_qty <> v_r.quantity then
    raise exception 'SHOP_DISPOSITION_QTY';
  end if;
  if v_refund < 0
     or v_refund > v_item.unit_price_paise * v_r.quantity
     or v_refund + coalesce((select sum(refund_paise) from public.order_returns where order_item_id = v_item.id and id <> v_r.id), 0)
        > v_item.line_total_paise
     or v_refund + coalesce((select sum(r.refund_paise) from public.order_returns r where r.order_id = v_order.id and r.id <> v_r.id), 0)
        > coalesce(v_order.cod_collected_paise, 0) then
    raise exception 'SHOP_REFUND_TOO_HIGH';
  end if;

  update public.order_returns set status = 'RESOLVED', restock_qty = p_restock_qty, write_off_qty = p_write_off_qty,
         refund_paise = v_refund, refund_status = case when v_refund > 0 then 'PENDING' else 'NONE' end,
         condition_note = v_note, resolved_by = p_actor, resolved_at = now()
   where id = p_return_id;
  perform public.shop_back_movement(p_actor, v_item, 'RETURN_RESTOCK', p_restock_qty, p_return_id, 'Return back to supplier ' || v_order.order_number);
  perform public.shop_back_movement(p_actor, v_item, 'RETURN_WRITE_OFF', p_write_off_qty, p_return_id, 'Return written off ' || v_order.order_number);
  if v_refund > 0 then
    update public.orders set payment_status = 'REFUND_PENDING' where id = v_order.id;
  end if;
  insert into public.order_events (order_id, event_type, to_value, customer_visible, note, actor_type, actor_staff_id)
  values (v_order.id, 'return_resolved', v_refund::text, true, '', 'STAFF', p_actor);
  return v_order.id;
end $$;

create or replace function public.mark_refund_paid(p_actor uuid, p_return_id uuid, p_method text) returns uuid
language plpgsql set search_path = public as $$
declare
  v_r public.order_returns;
begin
  perform public.shop_require_founder(p_actor);
  select * into v_r from public.order_returns where id = p_return_id;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  perform 1 from public.orders where id = v_r.order_id for update;
  select * into v_r from public.order_returns where id = p_return_id for update;
  if v_r.refund_status <> 'PENDING' then raise exception 'SHOP_STALE'; end if;
  if p_method is null or p_method not in ('CASH', 'UPI', 'OTHER') then raise exception 'SHOP_INVALID_INPUT'; end if;
  update public.order_returns set refund_status = 'PAID', refund_paid_at = now(), refund_paid_by = p_actor, refund_method = p_method
   where id = p_return_id;
  update public.orders set payment_status = case
      when exists (select 1 from public.order_returns where order_id = v_r.order_id and refund_status = 'PENDING') then 'REFUND_PENDING'
      else 'REFUNDED' end
   where id = v_r.order_id;
  insert into public.order_events (order_id, event_type, to_value, customer_visible, actor_type, actor_staff_id)
  values (v_r.order_id, 'refund_paid', v_r.refund_paise::text, true, 'STAFF', p_actor);
  return v_r.order_id;
end $$;

-- ── Report (§12), now with returns, refunds and write-offs ───────────────
-- Delivered orders count on their delivery day (cost = what the supplier is owed for them, after returns).
-- Refunds count on the day they were paid; expenses on the day recorded; cancelled-order write-offs on the
-- day decided.  net_profit = collected − supplier cost − refunds paid − expenses − cancelled write-offs.
create or replace function public.shop_finance_report(p_from date, p_to date) returns jsonb
language sql stable set search_path = public as $$
  with d as (
    select o.id, o.order_number, o.total_paise, coalesce(o.cod_collected_paise, 0) as collected,
           public.shop_order_payable(o.id) as cost, o.supplier_settlement_id is not null as settled,
           (o.delivered_at at time zone 'Asia/Kolkata')::date as day,
           (select coalesce(sum(e.amount_paise), 0) from public.order_expenses e where e.order_id = o.id and e.voided_at is null) as order_expenses,
           (select coalesce(sum(r.refund_paise), 0) from public.order_returns r where r.order_id = o.id and r.refund_status = 'PAID') as refunded
      from public.orders o
     where o.status = 'DELIVERED'
       and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), ex as (
    select coalesce(sum(amount_paise), 0) as total from public.order_expenses
     where voided_at is null and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), rf as (
    select coalesce(sum(refund_paise), 0) as total from public.order_returns
     where refund_status = 'PAID' and (refund_paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), wo as (
    select coalesce(sum(m.qty_change * coalesce(i.confirmed_unit_cost_paise, i.expected_unit_cost_paise)), 0) as total
      from public.inventory_movements m join public.order_items i on i.id = m.order_item_id
     where m.movement_type = 'CANCEL_WRITE_OFF' and (m.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), owed as (
    select count(*) as orders, coalesce(sum(public.shop_order_payable(o.id)), 0) as paise
      from public.orders o where o.status in ('DELIVERED', 'CANCELLED') and public.shop_order_settleable(o)
  ), credit as (
    select coalesce(sum(greatest(o.settled_payable_paise - public.shop_order_payable(o.id), 0)), 0) as paise
      from public.orders o where o.supplier_settlement_id is not null
  ), cancelled as (
    select count(*) as n from public.order_events
     where event_type = 'cancelled' and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), pending as (
    select count(*) filter (where status = 'RECEIVED') as returns_waiting,
           coalesce(sum(refund_paise) filter (where refund_status = 'PENDING'), 0) as refunds_pending_paise
      from public.order_returns
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'delivered_orders', (select count(*) from d),
    'cancelled_orders', (select n from cancelled),
    'sales_paise', (select coalesce(sum(total_paise), 0) from d),
    'collected_paise', (select coalesce(sum(collected), 0) from d),
    'supplier_cost_paise', (select coalesce(sum(cost), 0) from d),
    'expenses_paise', (select total from ex),
    'refunds_paid_paise', (select total from rf),
    'write_offs_paise', (select total from wo),
    'gross_margin_paise', (select coalesce(sum(total_paise - cost), 0) from d),
    'net_profit_paise', (select coalesce(sum(collected - cost), 0) from d) - (select total from ex)
                        - (select total from rf) - (select total from wo),
    'owed_to_supplier_paise', (select paise from owed),
    'owed_orders', (select orders from owed),
    'supplier_owes_back_paise', (select paise from credit),
    'returns_waiting', (select returns_waiting from pending),
    'refunds_pending_paise', (select refunds_pending_paise from pending),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'order_number', order_number, 'day', day, 'total_paise', total_paise, 'collected_paise', collected,
        'cost_paise', cost, 'expenses_paise', order_expenses, 'refunded_paise', refunded,
        'profit_paise', collected - refunded - cost - order_expenses,
        'settled', settled) order by day desc, order_number desc) from d), '[]'::jsonb)
  )
$$;

revoke execute on function
  public.shop_guard_return(),
  public.shop_order_settleable(public.orders),
  public.shop_pending_settlement(),
  public.shop_back_movement(uuid, public.order_items, text, integer, uuid, text),
  public.shop_dispose_line(uuid, uuid, uuid, integer, integer, text),
  public.record_return(uuid, uuid, uuid, integer, text),
  public.resolve_return(uuid, uuid, text, integer, integer, integer, text),
  public.mark_refund_paid(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.shop_order_settleable(public.orders),
  public.shop_pending_settlement(),
  public.shop_back_movement(uuid, public.order_items, text, integer, uuid, text),
  public.shop_dispose_line(uuid, uuid, uuid, integer, integer, text),
  public.record_return(uuid, uuid, uuid, integer, text),
  public.resolve_return(uuid, uuid, text, integer, integer, integer, text),
  public.mark_refund_paid(uuid, uuid, text)
to service_role;

do $$
begin
  if to_regprocedure('public.revoke_access_key(uuid,uuid,uuid)') is null then raise exception 'step25 check failed: run step24b first.'; end if;
  if to_regprocedure('public.mark_refund_paid(uuid,uuid,text)') is null
     or not exists (select 1 from pg_constraint where conname = 'order_returns_item_fk') then
    raise exception 'step25 check failed: something is missing. Run the WHOLE file with nothing selected.';
  end if;
  raise notice 'step25 OK';
end $$;

commit;
