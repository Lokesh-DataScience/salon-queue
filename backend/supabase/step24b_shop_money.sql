-- backend/supabase/step24b_shop_money.sql — Commerce Phase 1, C5b: supplier settlement, expenses, the profit
-- report, founder-callback recovery and key revocation (§4.8, §9.4, §12).
-- Needs step21–step24 (+ step22b). Run on the TESTS project first, with NOTHING highlighted. Ends with "step24b OK".
-- Then run step24b_shop_money_verify.sql. Production: run BEFORE deploying the C5b backend. Safe to run twice.
--
--  supplier_settlements      one payment to the supplier, covering one or more delivered orders (Q9: batched)
--  orders.supplier_settlement_id  composite FK (id, supplier_id): an order can only be settled by ITS supplier's payment
--  order_expenses            optional per-order costs (Q10). Voided, never deleted or edited.
--  record_supplier_settlement / record_order_expense / void_order_expense
--  shop_finance_report       read-only numbers for the founder and cofounder (never for customers)
--  create_recovery_code / redeem_recovery_code   founder callback: a 6-digit code read out on the phone
--  revoke_access_key         a lost phone's access stops at once
-- Every write is FOUNDER only (checked again here). Lock order: shop_customers → orders (ascending id) → expenses.

begin;

-- ── Settlements ──────────────────────────────────────────────────────────
create table if not exists public.supplier_settlements (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.suppliers (id) on delete restrict,
  paid_at      timestamptz not null default now(),
  amount_paise integer not null check (amount_paise > 0),
  payable_paise integer not null check (payable_paise >= 0),   -- what the orders added up to when paid
  order_count  integer not null check (order_count > 0),
  method       text not null check (method in ('CASH', 'UPI', 'BANK', 'OTHER')),
  reference    text not null default '' check (char_length(reference) <= 100),
  note         text not null default '' check (char_length(note) <= 300),
  recorded_by  uuid not null references public.salon_staff (id) on delete restrict,
  created_at   timestamptz not null default now(),
  constraint supplier_settlements_id_supplier_uq unique (id, supplier_id),             -- D25
  constraint supplier_settlements_mismatch_note check (amount_paise = payable_paise or char_length(btrim(note)) >= 3)
);
alter table public.supplier_settlements enable row level security;
revoke all on public.supplier_settlements from anon, authenticated;
create index if not exists supplier_settlements_paid_idx on public.supplier_settlements (paid_at desc);
drop trigger if exists supplier_settlements_append_only on public.supplier_settlements;
create trigger supplier_settlements_append_only before update or delete on public.supplier_settlements
  for each row execute function public.shop_movements_append_only();

alter table public.orders add column if not exists supplier_settlement_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_supplier_settlement_fk') then
    alter table public.orders add constraint orders_supplier_settlement_fk
      foreign key (supplier_settlement_id, supplier_id) references public.supplier_settlements (id, supplier_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_settled_needs_supplier') then
    -- MATCH SIMPLE skips the FK when supplier_id is null: never allow that combination.
    alter table public.orders add constraint orders_settled_needs_supplier
      check (supplier_settlement_id is null or supplier_id is not null);
  end if;
end $$;
create index if not exists orders_unsettled_idx on public.orders (supplier_id, delivered_at)
  where status = 'DELIVERED' and supplier_settlement_id is null;

-- Settled once, never moved to another payment or un-settled.
create or replace function public.shop_guard_order_settlement() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.supplier_settlement_id is not null and new.supplier_settlement_id is distinct from old.supplier_settlement_id then
    raise exception 'SHOP_ALREADY_SETTLED';
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_settlement on public.orders;
create trigger orders_guard_settlement before update of supplier_settlement_id on public.orders
  for each row execute function public.shop_guard_order_settlement();

-- ── Expenses ─────────────────────────────────────────────────────────────
create table if not exists public.order_expenses (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete restrict,
  kind         text not null check (kind in ('TRAVEL', 'PACKAGING', 'DELIVERY', 'OTHER')),
  amount_paise integer not null check (amount_paise > 0 and amount_paise <= 10000000),
  note         text not null default '' check (char_length(note) <= 300),
  recorded_by  uuid not null references public.salon_staff (id) on delete restrict,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references public.salon_staff (id) on delete restrict,
  void_reason  text not null default '' check (char_length(void_reason) <= 300),
  constraint order_expenses_void check (
    (voided_at is null and voided_by is null and void_reason = '')
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) >= 3))
);
alter table public.order_expenses enable row level security;
revoke all on public.order_expenses from anon, authenticated;
create index if not exists order_expenses_order_idx on public.order_expenses (order_id);
create index if not exists order_expenses_created_idx on public.order_expenses (created_at) where voided_at is null;

-- Only the void columns may change, once. No deletes.
create or replace function public.shop_guard_expense() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'SHOP_HISTORY_IMMUTABLE'; end if;
  if old.voided_at is not null
     or new.order_id is distinct from old.order_id or new.kind is distinct from old.kind
     or new.amount_paise is distinct from old.amount_paise or new.note is distinct from old.note
     or new.recorded_by is distinct from old.recorded_by or new.created_at is distinct from old.created_at then
    raise exception 'SHOP_HISTORY_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists order_expenses_guard on public.order_expenses;
create trigger order_expenses_guard before update or delete on public.order_expenses
  for each row execute function public.shop_guard_expense();

-- What the supplier is owed for one order: the confirmed rate (set at T3) × quantity.
create or replace function public.shop_order_payable(p_order_id uuid) returns integer
language sql stable set search_path = public as $$
  select coalesce(sum(coalesce(confirmed_unit_cost_paise, expected_unit_cost_paise) * quantity), 0)::integer
    from public.order_items where order_id = p_order_id
$$;

-- p_order_ids: delivered, unsettled orders of ONE supplier. A different amount needs a note (≥ 3 chars).
-- Returns {"settlement_id", "payable_paise", "order_count"}.
create or replace function public.record_supplier_settlement(
  p_actor uuid, p_order_ids uuid[], p_amount_paise integer, p_method text, p_reference text, p_note text,
  p_paid_at timestamptz default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_ids uuid[];
  v_supplier uuid;
  v_payable integer := 0;
  v_row record;
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

  for v_row in select id, status, supplier_id, supplier_settlement_id from public.orders where id = any (v_ids) order by id for update loop
    if v_row.status <> 'DELIVERED' or v_row.supplier_settlement_id is not null or v_row.supplier_id is null then
      raise exception 'SHOP_NOT_SETTLEABLE';
    end if;
    if v_supplier is null then v_supplier := v_row.supplier_id;
    elsif v_supplier <> v_row.supplier_id then raise exception 'SHOP_MIXED_SUPPLIERS';
    end if;
    v_payable := v_payable + public.shop_order_payable(v_row.id);
  end loop;
  if (select count(*) from public.orders where id = any (v_ids)) <> cardinality(v_ids) then raise exception 'SHOP_NOT_FOUND'; end if;
  if p_amount_paise <> v_payable and char_length(v_note) < 3 then raise exception 'SHOP_MISMATCH_NOTE_REQUIRED'; end if;

  insert into public.supplier_settlements (supplier_id, paid_at, amount_paise, payable_paise, order_count, method, reference, note, recorded_by)
  values (v_supplier, coalesce(p_paid_at, now()), p_amount_paise, v_payable, cardinality(v_ids), p_method,
          left(btrim(coalesce(p_reference, '')), 100), v_note, p_actor)
  returning id into v_id;
  -- "where … is null" is the final guard against a racing second settlement of the same order
  update public.orders set supplier_settlement_id = v_id where id = any (v_ids) and supplier_settlement_id is null;
  if not found or (select count(*) from public.orders where supplier_settlement_id = v_id) <> cardinality(v_ids) then
    raise exception 'SHOP_NOT_SETTLEABLE';
  end if;
  insert into public.order_events (order_id, event_type, to_value, customer_visible, actor_type, actor_staff_id)
  select x, 'supplier_settled', v_id::text, false, 'STAFF', p_actor from unnest(v_ids) x;
  return jsonb_build_object('settlement_id', v_id, 'payable_paise', v_payable, 'order_count', cardinality(v_ids));
end $$;

create or replace function public.record_order_expense(
  p_actor uuid, p_order_id uuid, p_kind text, p_amount_paise integer, p_note text
) returns uuid
language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  perform public.shop_require_founder(p_actor);
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 or p_amount_paise > 10000000 then raise exception 'SHOP_INVALID_QTY'; end if;
  if p_kind is null or p_kind not in ('TRAVEL', 'PACKAGING', 'DELIVERY', 'OTHER') then raise exception 'SHOP_INVALID_INPUT'; end if;
  insert into public.order_expenses (order_id, kind, amount_paise, note, recorded_by)
  values (p_order_id, p_kind, p_amount_paise, left(btrim(coalesce(p_note, '')), 300), p_actor)
  returning id into v_id;
  insert into public.order_events (order_id, event_type, to_value, customer_visible, actor_type, actor_staff_id)
  values (p_order_id, 'expense_added', p_amount_paise::text, false, 'STAFF', p_actor);
  return v_id;
end $$;

create or replace function public.void_order_expense(p_actor uuid, p_expense_id uuid, p_reason text) returns uuid
language plpgsql set search_path = public as $$
declare
  v_e public.order_expenses;
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
begin
  perform public.shop_require_founder(p_actor);
  select * into v_e from public.order_expenses where id = p_expense_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if v_e.voided_at is not null then raise exception 'SHOP_STALE'; end if;
  if char_length(v_reason) < 3 then raise exception 'SHOP_REASON_REQUIRED'; end if;
  update public.order_expenses set voided_at = now(), voided_by = p_actor, void_reason = v_reason where id = p_expense_id;
  insert into public.order_events (order_id, event_type, to_value, customer_visible, note, actor_type, actor_staff_id)
  values (v_e.order_id, 'expense_voided', v_e.amount_paise::text, false, v_reason, 'STAFF', p_actor);
  return v_e.order_id;
end $$;

-- ── Report (§12) ─────────────────────────────────────────────────────────
-- Orders DELIVERED between p_from and p_to (India dates, both inclusive). Expenses count by the day they were
-- recorded (any order, cancelled ones too — a wasted trip is still a cost). Refunds come in C6 (0 until then).
--   sales      what the delivered orders were priced at
--   collected  cash actually received
--   supplier_cost  confirmed rates × quantity
--   gross_margin = sales − supplier_cost;  net_profit = collected − supplier_cost − expenses − refunds_paid
-- plus what is still owed to the supplier for ALL delivered orders (not just this period).
create or replace function public.shop_finance_report(p_from date, p_to date) returns jsonb
language sql stable set search_path = public as $$
  with d as (
    select o.id, o.order_number, o.total_paise, coalesce(o.cod_collected_paise, 0) as collected,
           public.shop_order_payable(o.id) as cost, o.supplier_settlement_id is not null as settled,
           (o.delivered_at at time zone 'Asia/Kolkata')::date as day,
           (select coalesce(sum(e.amount_paise), 0) from public.order_expenses e where e.order_id = o.id and e.voided_at is null) as order_expenses
      from public.orders o
     where o.status = 'DELIVERED'
       and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), ex as (
    select coalesce(sum(amount_paise), 0) as total
      from public.order_expenses
     where voided_at is null and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), owed as (
    select count(*) as orders, coalesce(sum(public.shop_order_payable(id)), 0) as paise
      from public.orders where status = 'DELIVERED' and supplier_settlement_id is null
  ), cancelled as (
    select count(*) as n from public.order_events
     where event_type = 'cancelled' and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'delivered_orders', (select count(*) from d),
    'cancelled_orders', (select n from cancelled),
    'sales_paise', (select coalesce(sum(total_paise), 0) from d),
    'collected_paise', (select coalesce(sum(collected), 0) from d),
    'supplier_cost_paise', (select coalesce(sum(cost), 0) from d),
    'expenses_paise', (select total from ex),
    'refunds_paid_paise', 0,
    'gross_margin_paise', (select coalesce(sum(total_paise - cost), 0) from d),
    'net_profit_paise', (select coalesce(sum(collected - cost), 0) from d) - (select total from ex),
    'owed_to_supplier_paise', (select paise from owed),
    'owed_orders', (select orders from owed),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'order_number', order_number, 'day', day, 'total_paise', total_paise, 'collected_paise', collected,
        'cost_paise', cost, 'expenses_paise', order_expenses, 'profit_paise', collected - cost - order_expenses,
        'settled', settled) order by day desc, order_number desc) from d), '[]'::jsonb)
  )
$$;

-- ── Recovery (§9.4, founder callback) ───────────────────────────────────
-- Customer history gets the recovery events (types only, never codes or numbers).
alter table public.shop_customer_events drop constraint if exists shop_customer_events_event_type_check;
alter table public.shop_customer_events add constraint shop_customer_events_event_type_check
  check (event_type in ('details_changed', 'recovery_code_created', 'recovered', 'key_revoked'));

-- The founder calls the number on the customer record, then makes a code. The backend makes the 6 digits and
-- passes only sha256('recovery:' || phone || ':' || code). 15 minutes, single use, 5 wrong tries.
-- A new code replaces any unused one for the same customer.
create or replace function public.create_recovery_code(p_actor uuid, p_customer_id uuid, p_code_hash text) returns timestamptz
language plpgsql set search_path = public as $$
declare v_expires timestamptz := now() + interval '15 minutes';
begin
  perform public.shop_require_founder(p_actor);
  perform 1 from public.shop_customers where id = p_customer_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  update public.shop_verification_codes set expires_at = least(expires_at, now())
   where purpose = 'RECOVERY' and customer_id = p_customer_id and used_at is null and expires_at > now();
  insert into public.shop_verification_codes (purpose, customer_id, code_hash, expires_at, created_by_staff_id)
  values ('RECOVERY', p_customer_id, p_code_hash, v_expires, p_actor);
  insert into public.shop_customer_events (customer_id, event_type, fields)
  values (p_customer_id, 'recovery_code_created', '{}');
  return v_expires;
end $$;

-- The new phone: phone number + code. One answer for every failure (unknown phone, no code, wrong, expired,
-- used, too many tries), so the screen never reveals whether a number is a customer. Returns
-- {"result": "LINKED", "key_id"} (this device gets a fresh key; its old key stops) or {"result": "INVALID_CODE"}.
-- A wrong code is counted (no exception, so the count is kept).
create or replace function public.redeem_recovery_code(
  p_current_profile_id uuid, p_current_key_id uuid, p_phone_e164 text, p_code_hash text, p_new_key_hash text
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_customer uuid;
  v_code public.shop_verification_codes;
  v_key uuid;
begin
  select id into v_customer from public.shop_customers where phone_e164 = p_phone_e164 for update;
  if not found then return jsonb_build_object('result', 'INVALID_CODE'); end if;
  select * into v_code from public.shop_verification_codes
   where purpose = 'RECOVERY' and customer_id = v_customer and used_at is null and expires_at > now() and attempts < 5
   order by created_at desc limit 1
   for update;
  if not found then return jsonb_build_object('result', 'INVALID_CODE'); end if;
  if v_code.code_hash <> p_code_hash then
    update public.shop_verification_codes set attempts = attempts + 1 where id = v_code.id;
    return jsonb_build_object('result', 'INVALID_CODE');
  end if;

  update public.shop_verification_codes set used_at = now(), profile_id = p_current_profile_id where id = v_code.id;
  insert into public.shop_profile_customers (profile_id, customer_id, method, verified_by_staff_id)
  values (p_current_profile_id, v_customer, 'FOUNDER_CALLBACK', v_code.created_by_staff_id)
  on conflict (profile_id, customer_id) do update set verified_at = now(), method = 'FOUNDER_CALLBACK',
    verified_by_staff_id = excluded.verified_by_staff_id;
  update public.shop_customers set phone_verified_at = now() where id = v_customer;
  insert into public.shop_access_keys (profile_id, key_hash) values (p_current_profile_id, p_new_key_hash) returning id into v_key;
  update public.shop_access_keys set revoked_at = now()
   where id = p_current_key_id and profile_id = p_current_profile_id and revoked_at is null;
  insert into public.shop_customer_events (customer_id, event_type, fields, profile_id)
  values (v_customer, 'recovered', '{}', p_current_profile_id);
  return jsonb_build_object('result', 'LINKED', 'key_id', v_key);
end $$;

-- A lost or stolen phone: its key stops working at once (it gets an empty new session if it comes back).
-- Only keys of phones that can see this customer's orders.
create or replace function public.revoke_access_key(p_actor uuid, p_customer_id uuid, p_key_id uuid) returns void
language plpgsql set search_path = public as $$
declare v_profile uuid;
begin
  perform public.shop_require_founder(p_actor);
  select k.profile_id into v_profile from public.shop_access_keys k where k.id = p_key_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if not exists (select 1 from public.shop_profile_customers where profile_id = v_profile and customer_id = p_customer_id)
     and not exists (select 1 from public.orders where placed_by_profile_id = v_profile and customer_id = p_customer_id) then
    raise exception 'SHOP_NOT_FOUND';
  end if;
  update public.shop_access_keys set revoked_at = now() where id = p_key_id and revoked_at is null;
  if not found then raise exception 'SHOP_STALE'; end if;
  insert into public.shop_customer_events (customer_id, event_type, fields, profile_id)
  values (p_customer_id, 'key_revoked', '{}', v_profile);
end $$;

revoke execute on function
  public.shop_order_payable(uuid),
  public.record_supplier_settlement(uuid, uuid[], integer, text, text, text, timestamptz),
  public.record_order_expense(uuid, uuid, text, integer, text),
  public.void_order_expense(uuid, uuid, text),
  public.shop_finance_report(date, date),
  public.create_recovery_code(uuid, uuid, text),
  public.redeem_recovery_code(uuid, uuid, text, text, text),
  public.revoke_access_key(uuid, uuid, uuid),
  public.shop_guard_order_settlement(),
  public.shop_guard_expense()
from public, anon, authenticated;
grant execute on function
  public.shop_order_payable(uuid),
  public.record_supplier_settlement(uuid, uuid[], integer, text, text, text, timestamptz),
  public.record_order_expense(uuid, uuid, text, integer, text),
  public.void_order_expense(uuid, uuid, text),
  public.shop_finance_report(date, date),
  public.create_recovery_code(uuid, uuid, text),
  public.redeem_recovery_code(uuid, uuid, text, text, text),
  public.revoke_access_key(uuid, uuid, uuid)
to service_role;

do $$
begin
  if to_regprocedure('public.claim_due_placed_reminders()') is null then raise exception 'step24b check failed: run step24 first.'; end if;
  if to_regprocedure('public.revoke_access_key(uuid,uuid,uuid)') is null
     or not exists (select 1 from pg_constraint where conname = 'orders_supplier_settlement_fk') then
    raise exception 'step24b check failed: something is missing. Run the WHOLE file with nothing selected.';
  end if;
  raise notice 'step24b OK';
end $$;

commit;
