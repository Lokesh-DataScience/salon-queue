-- backend/supabase/step23_shop_orders.sql — Commerce Phase 1, C4: orders, lines, events, checkout, customer cancel.
-- Needs step21, step21b and step22. Run on the TESTS project first, with NOTHING highlighted.
-- Ends with "step23 OK". Then run step23_shop_orders_verify.sql (every row true).
-- Production: run BEFORE deploying the C4 backend. Safe to run twice.
--
-- Rules (COMMERCE_PHASE1_PLAN_FINAL.md §4.5–4.7, §7, §8.2):
--  - place_order is ONE transaction: idempotency lock → products locked in ascending id → priced by the
--    same pure shop_price_lines → customer row (insert-or-lock, NEVER updated here, D22) → limits →
--    stock reserved with one RESERVATION movement per line → order + line snapshots + first event.
--  - Lock order everywhere: idempotency → products (ascending id) → shop_customers → orders → order_items.
--  - Order and line snapshots never change; status changes only along the §7.2 arrows (trigger).
--  - order_events and inventory_movements are append-only.
--  - Nothing here changes an order by itself (D27). Customer cancel is allowed until OUT_FOR_DELIVERY (D8).

begin;

create sequence if not exists public.shop_order_number_seq start with 1001;

-- ── Orders ────────────────────────────────────────────────────────────────

create table if not exists public.orders (
  id                        uuid primary key default gen_random_uuid(),
  order_number              text not null unique default ('SQ-' || nextval('public.shop_order_number_seq')),
  customer_id               uuid not null references public.shop_customers (id) on delete restrict,
  placed_by_profile_id      uuid references public.shop_access_profiles (id) on delete set null,
  idempotency_key           uuid not null unique,
  request_hash              text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status                    text not null default 'PLACED' check (status in
                              ('PLACED','SUPPLIER_PENDING','SUPPLIER_CONFIRMED','COLLECTED',
                               'OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','CANCELLED')),
  payment_method            text not null default 'COD' check (payment_method = 'COD'),
  payment_status            text not null default 'COD_PENDING' check (payment_status in
                              ('COD_PENDING','COLLECTED','VOID','REFUND_PENDING','REFUNDED')),
  -- snapshot of the details given for THIS order
  customer_name             text not null check (char_length(btrim(customer_name)) between 1 and 80),
  customer_phone            text not null check (customer_phone ~ '^\+91[6-9][0-9]{9}$'),
  address_line1             text not null check (char_length(btrim(address_line1)) between 3 and 200),
  address_line2             text not null default '' check (char_length(address_line2) <= 200),
  landmark                  text not null default '' check (char_length(landmark) <= 120),
  pincode                   text not null default '' check (pincode = '' or pincode ~ '^[1-9][0-9]{5}$'),
  subtotal_paise            integer not null check (subtotal_paise > 0),
  delivery_fee_paise        integer not null default 0 check (delivery_fee_paise = 0),  -- D10
  total_paise               integer not null,
  seller_profile            jsonb not null default '{}'::jsonb,
  same_day_state            text not null default 'NOT_REQUESTED' check (same_day_state in
                              ('NOT_REQUESTED','REQUESTED','CONFIRMED','NOT_POSSIBLE')),
  expected_delivery_date    date,
  expected_delivery_note    text not null default '' check (char_length(expected_delivery_note) <= 200),
  cod_collected_paise       integer,
  cod_collected_at          timestamptz,
  cod_collected_by          uuid references public.salon_staff (id) on delete restrict,
  cod_mismatch_note         text not null default '' check (char_length(cod_mismatch_note) <= 300),
  supplier_id               uuid references public.suppliers (id) on delete restrict,
  supplier_contacted_at     timestamptz,
  source_salon_id           uuid references public.salons (id) on delete set null,
  source_entry_id           uuid references public.queue_entries (id) on delete set null,
  source_salon_customer_id  uuid references public.salon_customers (id) on delete set null,
  placed_reminder_count     integer not null default 0 check (placed_reminder_count >= 0),   -- D27
  last_placed_reminder_at   timestamptz,
  consent_at                timestamptz not null,
  cancel_reason             text not null default '' check (char_length(cancel_reason) <= 300),
  cancelled_by              text check (cancelled_by in ('CUSTOMER', 'FOUNDER')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  delivered_at              timestamptz,
  constraint orders_total check (total_paise = subtotal_paise + delivery_fee_paise),
  constraint orders_cod_positive check (cod_collected_paise is null or cod_collected_paise > 0),
  constraint orders_cod_recorded check (
    payment_status not in ('COLLECTED','REFUND_PENDING','REFUNDED')
    or (cod_collected_paise is not null and cod_collected_at is not null and cod_collected_by is not null)),
  constraint orders_cod_mismatch_note check (
    cod_collected_paise is null or cod_collected_paise = total_paise or char_length(btrim(cod_mismatch_note)) > 0),
  constraint orders_cancelled_by check ((status = 'CANCELLED') = (cancelled_by is not null))
);
create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);
create index if not exists orders_profile_idx on public.orders (placed_by_profile_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_placed_idx on public.orders (created_at) where status = 'PLACED';  -- reminder job (C5)

create table if not exists public.order_items (
  id                         uuid primary key default gen_random_uuid(),
  order_id                   uuid not null references public.orders (id) on delete restrict,
  product_id                 uuid references public.products (id) on delete set null,
  product_name               text not null,
  sku                        text not null,
  mrp_paise                  integer not null check (mrp_paise > 0),
  unit_price_paise           integer not null check (unit_price_paise > 0),
  quantity                   integer not null check (quantity between 1 and 20),
  line_total_paise           integer not null,
  expected_unit_cost_paise   integer not null check (expected_unit_cost_paise >= 0),
  confirmed_unit_cost_paise  integer check (confirmed_unit_cost_paise >= 0),
  stock_state                text not null default 'RESERVED' check (stock_state in
                               ('RESERVED','RELEASED','COMMITTED','AWAITING_DISPOSITION',
                                'CANCEL_RESTOCKED','CANCEL_WRITTEN_OFF','CANCEL_SPLIT')),  -- D20: no RETURNED
  cancel_restock_qty         integer not null default 0 check (cancel_restock_qty >= 0),
  cancel_write_off_qty       integer not null default 0 check (cancel_write_off_qty >= 0),
  created_at                 timestamptz not null default now(),
  constraint order_items_order_id_uq unique (order_id, id),  -- D25: target of composite FKs
  constraint order_items_line_total check (line_total_paise = unit_price_paise * quantity),
  constraint order_items_below_mrp check (unit_price_paise < mrp_paise),
  -- §7.4 disposition quantities
  constraint order_items_disposition check (
    case stock_state
      when 'CANCEL_RESTOCKED'   then cancel_restock_qty = quantity and cancel_write_off_qty = 0
      when 'CANCEL_WRITTEN_OFF' then cancel_restock_qty = 0 and cancel_write_off_qty = quantity
      when 'CANCEL_SPLIT'       then cancel_restock_qty > 0 and cancel_write_off_qty > 0
                                     and cancel_restock_qty + cancel_write_off_qty = quantity
      else cancel_restock_qty = 0 and cancel_write_off_qty = 0
    end)
);
create index if not exists order_items_product_idx on public.order_items (product_id);

create table if not exists public.order_events (
  id                bigint generated always as identity primary key,
  order_id          uuid not null references public.orders (id) on delete restrict,
  event_type        text not null check (char_length(event_type) between 1 and 40),
  from_value        text check (char_length(from_value) <= 40),
  to_value          text check (char_length(to_value) <= 40),
  customer_visible  boolean not null default false,
  note              text not null default '' check (char_length(note) <= 300),
  actor_type        text not null check (actor_type in ('STAFF', 'CUSTOMER', 'SYSTEM')),
  actor_staff_id    uuid references public.salon_staff (id) on delete restrict,
  created_at        timestamptz not null default now(),
  constraint order_events_staff_actor check (actor_type <> 'STAFF' or actor_staff_id is not null)
);
create index if not exists order_events_order_idx on public.order_events (order_id, id);

-- ── Stock history: order-line movements (§4.3, §7.5, §7.6) ─────────────────

alter table public.inventory_movements add column if not exists order_id uuid;
alter table public.inventory_movements add column if not exists order_item_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_order_item_fkey') then
    alter table public.inventory_movements
      add constraint inventory_movements_order_item_fkey
      foreign key (order_id, order_item_id) references public.order_items (order_id, id) on delete restrict;
  end if;
end $$;

alter table public.inventory_movements drop constraint if exists inventory_movements_type_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_product_level_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_amounts_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_refs_check;

alter table public.inventory_movements add constraint inventory_movements_type_check check (movement_type in (
  'INITIAL_STOCK','STOCK_COUNT','MANUAL_ADJUSTMENT','DAMAGED_STOCK',
  'SUPPLIER_REJECTION','RESERVATION','RELEASE','COMMIT','CANCEL_RESTOCK','CANCEL_WRITE_OFF'));

-- Product-level types: qty_change = signed change of on-hand. Order-line types: qty_change = the quantity (> 0).
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
    when 'CANCEL_WRITE_OFF'   then qty_change > 0 and on_hand_after = on_hand_before and reserved_after = reserved_before  -- a loss, never stock
    else false
  end);

alter table public.inventory_movements add constraint inventory_movements_refs_check check (
  case when movement_type in ('INITIAL_STOCK','STOCK_COUNT','MANUAL_ADJUSTMENT','DAMAGED_STOCK')
       then order_id is null and order_item_id is null
       else order_id is not null and order_item_id is not null
  end);

-- One reservation / release / commit / disposition per line (§7.6). Backstop for races.
create unique index if not exists inventory_movements_line_once
  on public.inventory_movements (order_item_id, movement_type) where order_item_id is not null;

-- ── Triggers ──────────────────────────────────────────────────────────────

drop trigger if exists order_events_no_update on public.order_events;
create trigger order_events_no_update before update or delete on public.order_events
  for each row execute function public.shop_movements_append_only();
drop trigger if exists order_events_no_truncate on public.order_events;
create trigger order_events_no_truncate before truncate on public.order_events
  for each statement execute function public.shop_movements_append_only();

-- Orders: snapshots never change; status only along the §7.2 arrows.
create or replace function public.shop_guard_order() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.order_number is distinct from old.order_number or new.customer_id is distinct from old.customer_id
     or new.idempotency_key is distinct from old.idempotency_key or new.request_hash is distinct from old.request_hash
     or new.payment_method is distinct from old.payment_method
     or new.customer_name is distinct from old.customer_name or new.customer_phone is distinct from old.customer_phone
     or new.address_line1 is distinct from old.address_line1 or new.address_line2 is distinct from old.address_line2
     or new.landmark is distinct from old.landmark or new.pincode is distinct from old.pincode
     or new.subtotal_paise is distinct from old.subtotal_paise or new.delivery_fee_paise is distinct from old.delivery_fee_paise
     or new.total_paise is distinct from old.total_paise or new.seller_profile is distinct from old.seller_profile
     or new.consent_at is distinct from old.consent_at or new.created_at is distinct from old.created_at
     -- references that only the database may clear (ON DELETE SET NULL)
     or (new.placed_by_profile_id is distinct from old.placed_by_profile_id and new.placed_by_profile_id is not null)
     or (new.source_salon_id is distinct from old.source_salon_id and new.source_salon_id is not null)
     or (new.source_entry_id is distinct from old.source_entry_id and new.source_entry_id is not null)
     or (new.source_salon_customer_id is distinct from old.source_salon_customer_id and new.source_salon_customer_id is not null)
  then
    raise exception 'SHOP_ORDER_SNAPSHOT_IMMUTABLE';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'PLACED'             and new.status in ('SUPPLIER_PENDING','CANCELLED'))
    or (old.status = 'SUPPLIER_PENDING'   and new.status in ('SUPPLIER_CONFIRMED','CANCELLED'))
    or (old.status = 'SUPPLIER_CONFIRMED' and new.status in ('COLLECTED','CANCELLED'))
    or (old.status = 'COLLECTED'          and new.status in ('OUT_FOR_DELIVERY','CANCELLED'))
    or (old.status = 'OUT_FOR_DELIVERY'   and new.status in ('DELIVERED','DELIVERY_FAILED'))
    or (old.status = 'DELIVERY_FAILED'    and new.status in ('OUT_FOR_DELIVERY','CANCELLED'))
  ) then
    raise exception 'SHOP_BAD_TRANSITION';
  end if;
  return new;
end $$;

drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before update on public.orders for each row execute function public.shop_guard_order();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
drop trigger if exists orders_no_delete on public.orders;
create trigger orders_no_delete before delete on public.orders for each row execute function public.shop_movements_append_only();

-- Order lines: snapshots never change; confirmed cost set once; stock state only along §7.3.
create or replace function public.shop_guard_order_item() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.order_id is distinct from old.order_id or new.product_name is distinct from old.product_name
     or new.sku is distinct from old.sku or new.mrp_paise is distinct from old.mrp_paise
     or new.unit_price_paise is distinct from old.unit_price_paise or new.quantity is distinct from old.quantity
     or new.line_total_paise is distinct from old.line_total_paise
     or new.expected_unit_cost_paise is distinct from old.expected_unit_cost_paise
     or new.created_at is distinct from old.created_at
     or (new.product_id is distinct from old.product_id and new.product_id is not null)
     or (old.confirmed_unit_cost_paise is not null and new.confirmed_unit_cost_paise is distinct from old.confirmed_unit_cost_paise)
  then
    raise exception 'SHOP_ORDER_SNAPSHOT_IMMUTABLE';
  end if;
  if new.stock_state is distinct from old.stock_state and not (
       (old.stock_state = 'RESERVED'             and new.stock_state in ('RELEASED','COMMITTED'))
    or (old.stock_state = 'COMMITTED'            and new.stock_state = 'AWAITING_DISPOSITION')
    or (old.stock_state = 'AWAITING_DISPOSITION' and new.stock_state in ('CANCEL_RESTOCKED','CANCEL_WRITTEN_OFF','CANCEL_SPLIT'))
  ) then
    raise exception 'SHOP_BAD_STOCK_STATE';
  end if;
  return new;
end $$;

drop trigger if exists order_items_guard on public.order_items;
create trigger order_items_guard before update on public.order_items for each row execute function public.shop_guard_order_item();
drop trigger if exists order_items_no_delete on public.order_items;
create trigger order_items_no_delete before delete on public.order_items for each row execute function public.shop_movements_append_only();

-- ── Checkout (§8.2) ───────────────────────────────────────────────────────
-- p_customer: {"name","phone_e164","address_line1","address_line2","landmark","pincode"} (backend-validated)
-- p_source:   {"salon_id","entry_id","salon_customer_id"} (optional attribution; all may be null)
-- Returns {"result": "CREATED"|"EXISTING", "order_id", "order_number"}
--      or {"result": "PRICE_CHANGED"|"CART_PROBLEM", "quote": {...}}  (nothing written)
--      or {"result": "TOO_MANY_OPEN_ORDERS", "max": n}                (nothing written)
create or replace function public.place_order(
  p_profile_id uuid, p_idempotency_key uuid, p_request_hash text, p_items jsonb,
  p_expected_total_paise integer, p_customer jsonb, p_consent boolean, p_request_same_day boolean, p_source jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_existing public.orders;
  v_ids uuid[];
  v_products jsonb;
  v_settings jsonb;
  v_quote jsonb;
  v_customer uuid;
  v_open integer;
  v_max_open integer;
  v_order public.orders;
  v_line jsonb;
  v_p public.products;
  v_item_id uuid;
  v_supplier uuid;
  v_same_day text;
begin
  -- 1. validate
  if p_profile_id is null or p_idempotency_key is null or p_customer is null then raise exception 'SHOP_INVALID_INPUT'; end if;
  if not coalesce(p_consent, false) then raise exception 'SHOP_NO_CONSENT'; end if;
  if not exists (select 1 from public.shop_access_profiles where id = p_profile_id) then raise exception 'SHOP_FORBIDDEN'; end if;

  -- 2. one attempt per key at a time
  perform pg_advisory_xact_lock(hashtextextended('shop_order:' || p_idempotency_key::text, 0));

  -- 3. same key again: same request → the same order; different request → refuse
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash and v_existing.placed_by_profile_id is not distinct from p_profile_id then
      return jsonb_build_object('result', 'EXISTING', 'order_id', v_existing.id, 'order_number', v_existing.order_number);
    end if;
    raise exception 'IDEMPOTENCY_MISMATCH';
  end if;

  -- 4. lock products in ascending id (READ COMMITTED: we then see the latest committed rows)
  select array_agg(distinct (e->>'product_id')::uuid) into v_ids from jsonb_array_elements(p_items) e;
  perform 1 from public.products where id = any (v_ids) order by id for update;

  -- 5. price with the locked values (the same pure function as the quote)
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_products from public.products p where p.id = any (v_ids);
  select to_jsonb(s) into v_settings from public.shop_settings s where s.id;
  v_quote := public.shop_price_lines(p_items, v_products, v_settings, (now() at time zone 'Asia/Kolkata')::time);
  if not (v_quote->>'ok')::boolean then
    return jsonb_build_object('result', 'CART_PROBLEM', 'quote', v_quote);
  end if;

  -- 6. the customer must have seen this exact total
  if (v_quote->>'total_paise')::integer is distinct from p_expected_total_paise then
    return jsonb_build_object('result', 'PRICE_CHANGED', 'quote', v_quote);
  end if;

  -- 7. customer: created with these details the first time; an existing row is NEVER changed here (D22)
  insert into public.shop_customers (phone_e164, display_name, address_line1, address_line2, landmark, pincode)
  values (p_customer->>'phone_e164', btrim(p_customer->>'name'), btrim(p_customer->>'address_line1'),
          coalesce(btrim(p_customer->>'address_line2'), ''), coalesce(btrim(p_customer->>'landmark'), ''),
          coalesce(p_customer->>'pincode', ''))
  on conflict (phone_e164) do nothing;
  select id into v_customer from public.shop_customers where phone_e164 = p_customer->>'phone_e164' for update;

  -- 8. open COD orders per customer (Q7)
  v_max_open := coalesce((v_settings->>'max_open_cod_orders_per_customer')::integer, 2);
  select count(*) into v_open from public.orders
   where customer_id = v_customer and status not in ('DELIVERED', 'CANCELLED');
  if v_open >= v_max_open then
    return jsonb_build_object('result', 'TOO_MANY_OPEN_ORDERS', 'max', v_max_open);
  end if;

  -- 10a. the order (snapshot of the details given now)
  select id into v_supplier from public.suppliers where is_active;
  v_same_day := case when coalesce(p_request_same_day, false) and (v_quote->>'same_day_requestable')::boolean
                     then 'REQUESTED' else 'NOT_REQUESTED' end;
  insert into public.orders (
    customer_id, placed_by_profile_id, idempotency_key, request_hash,
    customer_name, customer_phone, address_line1, address_line2, landmark, pincode,
    subtotal_paise, delivery_fee_paise, total_paise, seller_profile, same_day_state, supplier_id,
    source_salon_id, source_entry_id, source_salon_customer_id, consent_at
  ) values (
    v_customer, p_profile_id, p_idempotency_key, p_request_hash,
    btrim(p_customer->>'name'), p_customer->>'phone_e164', btrim(p_customer->>'address_line1'),
    coalesce(btrim(p_customer->>'address_line2'), ''), coalesce(btrim(p_customer->>'landmark'), ''),
    coalesce(p_customer->>'pincode', ''),
    (v_quote->>'subtotal_paise')::integer, (v_quote->>'delivery_fee_paise')::integer, (v_quote->>'total_paise')::integer,
    coalesce(v_settings->'seller_profile', '{}'::jsonb), v_same_day, v_supplier,
    (select id from public.salons where id = nullif(p_source->>'salon_id', '')::uuid),
    (select id from public.queue_entries where id = nullif(p_source->>'entry_id', '')::uuid),
    (select id from public.salon_customers where id = nullif(p_source->>'salon_customer_id', '')::uuid),
    now()
  ) returning * into v_order;

  -- 9 + 10b. lines, reservations (stock_reserved <= stock_on_hand is the backstop)
  for v_line in select e from jsonb_array_elements(v_quote->'lines') e loop
    select * into v_p from public.products where id = (v_line->>'product_id')::uuid;
    insert into public.order_items (order_id, product_id, product_name, sku, mrp_paise, unit_price_paise, quantity,
                                    line_total_paise, expected_unit_cost_paise)
    values (v_order.id, v_p.id, v_p.name, v_p.sku, v_p.mrp_paise, v_p.selling_price_paise, (v_line->>'qty')::integer,
            v_p.selling_price_paise * (v_line->>'qty')::integer, v_p.wholesale_cost_paise)
    returning id into v_item_id;

    perform set_config('shop.stock_write', 'on', true);
    update public.products set stock_reserved = stock_reserved + (v_line->>'qty')::integer where id = v_p.id;
    perform set_config('shop.stock_write', 'off', true);

    insert into public.inventory_movements (product_id, movement_type, qty_change, on_hand_before, on_hand_after,
      reserved_before, reserved_after, reason, actor_type, order_id, order_item_id)
    values (v_p.id, 'RESERVATION', (v_line->>'qty')::integer, v_p.stock_on_hand, v_p.stock_on_hand,
      v_p.stock_reserved, v_p.stock_reserved + (v_line->>'qty')::integer, 'Order ' || v_order.order_number,
      'CUSTOMER', v_order.id, v_item_id);
  end loop;

  insert into public.order_events (order_id, event_type, to_value, customer_visible, actor_type)
  values (v_order.id, 'placed', 'PLACED', true, 'CUSTOMER');
  if v_same_day = 'REQUESTED' then
    insert into public.order_events (order_id, event_type, to_value, customer_visible, actor_type)
    values (v_order.id, 'same_day', 'REQUESTED', true, 'CUSTOMER');
  end if;

  return jsonb_build_object('result', 'CREATED', 'order_id', v_order.id, 'order_number', v_order.order_number);
end $$;

-- Can this device profile see / act on this order? (placed it, or is linked to the order's customer)
create or replace function public.shop_profile_owns_order(p_profile_id uuid, p_order public.orders) returns boolean
language sql stable set search_path = public as $$
  select p_profile_id is not null and (
    p_order.placed_by_profile_id = p_profile_id
    or exists (select 1 from public.shop_profile_customers pc
                where pc.profile_id = p_profile_id and pc.customer_id = p_order.customer_id));
$$;

-- Customer cancel (D8): allowed until OUT_FOR_DELIVERY.
--   PLACED / SUPPLIER_PENDING:     reserved stock is released (T5/T6)
--   SUPPLIER_CONFIRMED / COLLECTED: lines wait for the founder's stock decision (T8/T10, C6)
create or replace function public.customer_cancel_order(p_profile_id uuid, p_order_id uuid, p_reason text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_order public.orders;
  v_item public.order_items;
  v_p public.products;
  v_ids uuid[];
begin
  -- lock order: products first (ascending id), then the order, then its lines
  select array_agg(product_id order by product_id) into v_ids
    from public.order_items where order_id = p_order_id and product_id is not null;
  perform 1 from public.products where id = any (coalesce(v_ids, '{}')) order by id for update;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not public.shop_profile_owns_order(p_profile_id, v_order) then
    raise exception 'SHOP_NOT_FOUND';  -- same answer as "doesn't exist": never confirm someone else's order
  end if;
  if v_order.status not in ('PLACED', 'SUPPLIER_PENDING', 'SUPPLIER_CONFIRMED', 'COLLECTED') then
    raise exception 'SHOP_CANNOT_CANCEL';
  end if;

  for v_item in select * from public.order_items where order_id = p_order_id order by id for update loop
    if v_order.status in ('PLACED', 'SUPPLIER_PENDING') and v_item.stock_state = 'RESERVED' then
      select * into v_p from public.products where id = v_item.product_id;
      if found then
        perform set_config('shop.stock_write', 'on', true);
        update public.products set stock_reserved = stock_reserved - v_item.quantity where id = v_p.id;
        perform set_config('shop.stock_write', 'off', true);
        insert into public.inventory_movements (product_id, movement_type, qty_change, on_hand_before, on_hand_after,
          reserved_before, reserved_after, reason, actor_type, order_id, order_item_id)
        values (v_p.id, 'RELEASE', v_item.quantity, v_p.stock_on_hand, v_p.stock_on_hand,
          v_p.stock_reserved, v_p.stock_reserved - v_item.quantity, 'Cancelled by customer', 'CUSTOMER', p_order_id, v_item.id);
      end if;
      update public.order_items set stock_state = 'RELEASED' where id = v_item.id;
    elsif v_item.stock_state = 'COMMITTED' then
      update public.order_items set stock_state = 'AWAITING_DISPOSITION' where id = v_item.id;
    end if;
  end loop;

  update public.orders
     set status = 'CANCELLED', payment_status = 'VOID', cancelled_by = 'CUSTOMER',
         cancel_reason = left(btrim(coalesce(p_reason, '')), 300)
   where id = p_order_id;
  insert into public.order_events (order_id, event_type, from_value, to_value, customer_visible, note, actor_type)
  values (p_order_id, 'cancelled', v_order.status, 'CANCELLED', true, left(btrim(coalesce(p_reason, '')), 300), 'CUSTOMER');

  return jsonb_build_object('status', 'CANCELLED', 'order_number', v_order.order_number);
end $$;

-- ── Lock down ─────────────────────────────────────────────────────────────

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
revoke all on table public.orders, public.order_items, public.order_events from anon, authenticated;
revoke all on sequence public.shop_order_number_seq, public.order_events_id_seq from anon, authenticated;

revoke execute on function
  public.shop_guard_order(), public.shop_guard_order_item(),
  public.place_order(uuid, uuid, text, jsonb, integer, jsonb, boolean, boolean, jsonb),
  public.shop_profile_owns_order(uuid, public.orders),
  public.customer_cancel_order(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.place_order(uuid, uuid, text, jsonb, integer, jsonb, boolean, boolean, jsonb),
  public.shop_profile_owns_order(uuid, public.orders),
  public.customer_cancel_order(uuid, uuid, text)
to service_role;

do $$
begin
  if (select count(*) from information_schema.tables where table_schema = 'public'
       and table_name in ('orders', 'order_items', 'order_events')) <> 3 then
    raise exception 'step23 check failed: a table is missing. Run the WHOLE file with nothing selected.';
  end if;
  if to_regprocedure('public.shop_price_lines(jsonb,jsonb,jsonb,time)') is null then
    raise exception 'step23 check failed: run step21b_shop_pricing.sql first.';
  end if;
  if to_regclass('public.shop_customers') is null then raise exception 'step23 check failed: run step22 first.'; end if;
  raise notice 'step23 OK';
end $$;

commit;
