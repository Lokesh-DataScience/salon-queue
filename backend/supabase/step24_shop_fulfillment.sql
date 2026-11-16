-- backend/supabase/step24_shop_fulfillment.sql — Commerce Phase 1, C5a: the founder moves orders (§7.2, §11, §12, §15.2).
-- Needs step21–step23 (+ step22b). Run on the TESTS project first, with NOTHING highlighted. Ends with "step24 OK".
-- Then run step24_shop_fulfillment_verify.sql. Production: run BEFORE deploying the C5a backend. Safe to run twice.
--
--  shop_transition_order   every founder move T2–T10, T12–T14, with expected_from (stale screen / double tap → 409)
--  record_cod_collection   T11: the ONLY way to DELIVERED; cash amount > 0, a different amount needs a note
--  set_delivery_expectation expected date/note and the same-day decision (REQUESTED → CONFIRMED | NOT_POSSIBLE)
--  claim_due_placed_reminders  one atomic UPDATE: a restart or two servers never send the same reminder twice (D27)
-- All are FOUNDER only (re-checked here). Lock order: products (ascending id) → orders → order_items.
-- Nothing here ever changes an order by itself: reminders only remind.

begin;

-- Internal: one order-line stock movement (caller holds the product + line locks).
create or replace function public.shop_line_movement(
  p_actor uuid, p_order_id uuid, p_item public.order_items, p_type text, p_reason text
) returns void
language plpgsql set search_path = public as $$
declare
  v_p public.products;
  v_on integer;
  v_res integer;
begin
  select * into v_p from public.products where id = p_item.product_id;
  if not found then return; end if;  -- product hard-deleted: nothing to move
  v_on := v_p.stock_on_hand;
  v_res := v_p.stock_reserved;
  if p_type = 'RELEASE' then v_res := v_res - p_item.quantity;
  elsif p_type = 'COMMIT' then v_on := v_on - p_item.quantity; v_res := v_res - p_item.quantity;
  else raise exception 'SHOP_INVALID_INPUT';
  end if;

  perform set_config('shop.stock_write', 'on', true);
  update public.products set stock_on_hand = v_on, stock_reserved = v_res where id = v_p.id;
  perform set_config('shop.stock_write', 'off', true);

  insert into public.inventory_movements (product_id, movement_type, qty_change, on_hand_before, on_hand_after,
    reserved_before, reserved_after, reason, actor_type, actor_staff_id, order_id, order_item_id)
  values (v_p.id, p_type, p_item.quantity, v_p.stock_on_hand, v_on, v_p.stock_reserved, v_res,
    left(coalesce(p_reason, ''), 300), 'STAFF', p_actor, p_order_id, p_item.id);
end $$;

-- p_to:        SUPPLIER_PENDING | SUPPLIER_CONFIRMED | COLLECTED | OUT_FOR_DELIVERY | DELIVERY_FAILED | CANCELLED
-- p_note:      required for CANCELLED and DELIVERY_FAILED (shown to the customer as the reason)
-- p_lines:     T3 only: [{"item_id": uuid, "confirmed_unit_cost_paise": int}, ...] for EVERY line
-- p_delivery:  T3 optional: {"date": "YYYY-MM-DD", "note": text, "same_day": "CONFIRMED" | "NOT_POSSIBLE"}
-- p_mark_out_of_stock: T4 only — the supplier has none: what isn't reserved by other orders stops being sellable
create or replace function public.shop_transition_order(
  p_actor uuid, p_order_id uuid, p_expected_from text, p_to text, p_note text,
  p_lines jsonb default null, p_delivery jsonb default null, p_mark_out_of_stock boolean default false
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_order public.orders;
  v_item public.order_items;
  v_p public.products;
  v_ids uuid[];
  v_note text := left(btrim(coalesce(p_note, '')), 300);
  v_cost integer;
  v_drop integer;
  v_same_day text;
begin
  perform public.shop_require_founder(p_actor);

  select array_agg(product_id order by product_id) into v_ids
    from public.order_items where order_id = p_order_id and product_id is not null;
  perform 1 from public.products where id = any (coalesce(v_ids, '{}')) order by id for update;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if v_order.status is distinct from p_expected_from then raise exception 'SHOP_STALE'; end if;

  -- which arrows the founder may take (T11 DELIVERED only via record_cod_collection)
  if not (
       (v_order.status = 'PLACED'             and p_to in ('SUPPLIER_PENDING', 'CANCELLED'))
    or (v_order.status = 'SUPPLIER_PENDING'   and p_to in ('SUPPLIER_CONFIRMED', 'CANCELLED'))
    or (v_order.status = 'SUPPLIER_CONFIRMED' and p_to in ('COLLECTED', 'CANCELLED'))
    or (v_order.status = 'COLLECTED'          and p_to in ('OUT_FOR_DELIVERY', 'CANCELLED'))
    or (v_order.status = 'OUT_FOR_DELIVERY'   and p_to = 'DELIVERY_FAILED')
    or (v_order.status = 'DELIVERY_FAILED'    and p_to in ('OUT_FOR_DELIVERY', 'CANCELLED'))
  ) then
    raise exception 'SHOP_BAD_TRANSITION';
  end if;
  if p_to in ('CANCELLED', 'DELIVERY_FAILED') and char_length(v_note) < 3 then raise exception 'SHOP_REASON_REQUIRED'; end if;

  if p_to = 'SUPPLIER_CONFIRMED' then
    -- T3: every line needs the supplier's confirmed rate; stock is committed (on hand and reserved both go down)
    if p_lines is null or jsonb_typeof(p_lines) <> 'array'
       or (select count(*) from public.order_items where order_id = p_order_id)
          <> (select count(distinct e->>'item_id') from jsonb_array_elements(p_lines) e
               where (e->>'item_id')::uuid in (select id from public.order_items where order_id = p_order_id)) then
      raise exception 'SHOP_COSTS_REQUIRED';
    end if;
    for v_item in select * from public.order_items where order_id = p_order_id order by id for update loop
      select (e->>'confirmed_unit_cost_paise')::integer into v_cost
        from jsonb_array_elements(p_lines) e where (e->>'item_id')::uuid = v_item.id limit 1;
      if v_cost is null or v_cost < 0 then raise exception 'SHOP_COSTS_REQUIRED'; end if;
      update public.order_items set confirmed_unit_cost_paise = v_cost, stock_state = 'COMMITTED' where id = v_item.id;
      perform public.shop_line_movement(p_actor, p_order_id, v_item, 'COMMIT', 'Supplier confirmed ' || v_order.order_number);
    end loop;
    v_same_day := case
      when v_order.same_day_state = 'REQUESTED' and p_delivery->>'same_day' in ('CONFIRMED', 'NOT_POSSIBLE') then p_delivery->>'same_day'
      when v_order.same_day_state = 'REQUESTED' then 'NOT_POSSIBLE'  -- not confirmed = not promised (D3)
      else v_order.same_day_state end;
    update public.orders set
      expected_delivery_date = coalesce(nullif(p_delivery->>'date', '')::date, expected_delivery_date),
      expected_delivery_note = left(coalesce(p_delivery->>'note', expected_delivery_note), 200),
      same_day_state = v_same_day
    where id = p_order_id;
    if v_same_day is distinct from v_order.same_day_state then
      insert into public.order_events (order_id, event_type, from_value, to_value, customer_visible, actor_type, actor_staff_id)
      values (p_order_id, 'same_day', v_order.same_day_state, v_same_day, true, 'STAFF', p_actor);
    end if;

  elsif p_to = 'CANCELLED' then
    for v_item in select * from public.order_items where order_id = p_order_id order by id for update loop
      if v_item.stock_state = 'RESERVED' then
        -- T4 / T5: nothing left the supplier yet: release the reservation
        perform public.shop_line_movement(p_actor, p_order_id, v_item, 'RELEASE', 'Cancelled: ' || v_note);
        update public.order_items set stock_state = 'RELEASED' where id = v_item.id;
        if p_mark_out_of_stock and v_order.status = 'SUPPLIER_PENDING' then
          select * into v_p from public.products where id = v_item.product_id;
          v_drop := coalesce(v_p.stock_on_hand - v_p.stock_reserved, 0);
          if v_drop > 0 then
            perform set_config('shop.stock_write', 'on', true);
            update public.products set stock_on_hand = stock_on_hand - v_drop where id = v_p.id;
            perform set_config('shop.stock_write', 'off', true);
            insert into public.inventory_movements (product_id, movement_type, qty_change, on_hand_before, on_hand_after,
              reserved_before, reserved_after, reason, actor_type, actor_staff_id, order_id, order_item_id)
            values (v_p.id, 'SUPPLIER_REJECTION', v_drop, v_p.stock_on_hand, v_p.stock_on_hand - v_drop,
              v_p.stock_reserved, v_p.stock_reserved, 'Supplier has none', 'STAFF', p_actor, p_order_id, v_item.id);
          end if;
        end if;
      elsif v_item.stock_state = 'COMMITTED' then
        -- T8 / T10 / T14: goods were confirmed or collected: the founder decides restock / write-off (C6)
        update public.order_items set stock_state = 'AWAITING_DISPOSITION' where id = v_item.id;
      end if;
    end loop;
    update public.orders set status = 'CANCELLED', payment_status = 'VOID', cancelled_by = 'FOUNDER', cancel_reason = v_note
     where id = p_order_id;

  elsif p_to = 'SUPPLIER_PENDING' then
    update public.orders set supplier_contacted_at = coalesce(supplier_contacted_at, now()) where id = p_order_id;
  end if;

  if p_to <> 'CANCELLED' then
    update public.orders set status = p_to where id = p_order_id;
  end if;
  insert into public.order_events (order_id, event_type, from_value, to_value, customer_visible, note, actor_type, actor_staff_id)
  values (p_order_id, case when p_to = 'CANCELLED' then 'cancelled' else 'status' end, v_order.status, p_to, true,
          case when p_to in ('CANCELLED', 'DELIVERY_FAILED') then v_note else '' end, 'STAFF', p_actor);

  return jsonb_build_object('status', p_to, 'order_number', v_order.order_number);
end $$;

-- T11: cash collected at the door → DELIVERED + COLLECTED. A second call fails the state check.
create or replace function public.record_cod_collection(
  p_actor uuid, p_order_id uuid, p_amount_paise integer, p_mismatch_note text
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_order public.orders;
  v_note text := left(btrim(coalesce(p_mismatch_note, '')), 300);
begin
  perform public.shop_require_founder(p_actor);
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if v_order.status <> 'OUT_FOR_DELIVERY' or v_order.payment_status <> 'COD_PENDING' then raise exception 'SHOP_STALE'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'SHOP_INVALID_QTY'; end if;
  if p_amount_paise <> v_order.total_paise and char_length(v_note) < 3 then raise exception 'SHOP_MISMATCH_NOTE_REQUIRED'; end if;

  update public.orders set
    cod_collected_paise = p_amount_paise, cod_collected_at = now(), cod_collected_by = p_actor,
    cod_mismatch_note = case when p_amount_paise = v_order.total_paise then '' else v_note end,
    payment_status = 'COLLECTED', status = 'DELIVERED', delivered_at = now()
  where id = p_order_id;
  insert into public.order_events (order_id, event_type, from_value, to_value, customer_visible, actor_type, actor_staff_id)
  values (p_order_id, 'status', 'OUT_FOR_DELIVERY', 'DELIVERED', true, 'STAFF', p_actor);
  insert into public.order_events (order_id, event_type, to_value, customer_visible, note, actor_type, actor_staff_id)
  values (p_order_id, 'cod_collected', p_amount_paise::text, false, v_note, 'STAFF', p_actor);
  return jsonb_build_object('status', 'DELIVERED', 'order_number', v_order.order_number);
end $$;

-- Expected delivery and the same-day decision, any time before the order is finished.
create or replace function public.set_delivery_expectation(
  p_actor uuid, p_order_id uuid, p_date date, p_note text, p_same_day text
) returns void
language plpgsql set search_path = public as $$
declare v_order public.orders;
begin
  perform public.shop_require_founder(p_actor);
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if v_order.status in ('DELIVERED', 'CANCELLED') then raise exception 'SHOP_STALE'; end if;
  if p_same_day is not null and not (
       (v_order.same_day_state = 'REQUESTED' and p_same_day in ('CONFIRMED', 'NOT_POSSIBLE'))
    or (v_order.same_day_state = 'CONFIRMED' and p_same_day = 'NOT_POSSIBLE')
    or p_same_day = v_order.same_day_state) then
    raise exception 'SHOP_BAD_TRANSITION';
  end if;
  update public.orders set expected_delivery_date = p_date, expected_delivery_note = left(coalesce(p_note, ''), 200),
         same_day_state = coalesce(p_same_day, same_day_state)
   where id = p_order_id;
  insert into public.order_events (order_id, event_type, from_value, to_value, customer_visible, note, actor_type, actor_staff_id)
  values (p_order_id, 'delivery_expectation', v_order.same_day_state, coalesce(p_same_day, v_order.same_day_state), true,
          left(coalesce(p_note, ''), 300), 'STAFF', p_actor);
end $$;

-- §15.2 / D27: claim every PLACED order that is due a reminder, in ONE statement. Returns [{order_id, order_number}].
create or replace function public.claim_due_placed_reminders() returns jsonb
language plpgsql set search_path = public as $$
declare
  v_after integer;
  v_repeat integer;
  v_rows jsonb;
begin
  select placed_reminder_after_minutes, placed_reminder_repeat_minutes into v_after, v_repeat
    from public.shop_settings where id;
  with due as (
    update public.orders o
       set last_placed_reminder_at = now(), placed_reminder_count = o.placed_reminder_count + 1
     where o.status = 'PLACED'
       and o.created_at <= now() - make_interval(mins => v_after)
       and (o.last_placed_reminder_at is null or o.last_placed_reminder_at <= now() - make_interval(mins => v_repeat))
    returning o.id, o.order_number
  ), ev as (
    insert into public.order_events (order_id, event_type, customer_visible, actor_type)
    select id, 'placed_reminder_sent', false, 'SYSTEM' from due
    returning order_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('order_id', d.id, 'order_number', d.order_number)), '[]'::jsonb)
    into v_rows from due d;
  return v_rows;
end $$;

revoke execute on function
  public.shop_line_movement(uuid, uuid, public.order_items, text, text),
  public.shop_transition_order(uuid, uuid, text, text, text, jsonb, jsonb, boolean),
  public.record_cod_collection(uuid, uuid, integer, text),
  public.set_delivery_expectation(uuid, uuid, date, text, text),
  public.claim_due_placed_reminders()
from public, anon, authenticated;
grant execute on function
  public.shop_line_movement(uuid, uuid, public.order_items, text, text),
  public.shop_transition_order(uuid, uuid, text, text, text, jsonb, jsonb, boolean),
  public.record_cod_collection(uuid, uuid, integer, text),
  public.set_delivery_expectation(uuid, uuid, date, text, text),
  public.claim_due_placed_reminders()
to service_role;

do $$
begin
  if to_regclass('public.orders') is null then raise exception 'step24 check failed: run step23 first.'; end if;
  if to_regprocedure('public.claim_due_placed_reminders()') is null then
    raise exception 'step24 check failed: something is missing. Run the WHOLE file with nothing selected.';
  end if;
  raise notice 'step24 OK';
end $$;

commit;
