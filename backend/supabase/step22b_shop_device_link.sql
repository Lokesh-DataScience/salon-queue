-- backend/supabase/step22b_shop_device_link.sql — Commerce Phase 1, C4b: device linking, saved default details,
-- and a read-only "orders in rupees" view for the SQL editor.
-- Needs step22 + step23. Run on the TESTS project first, with NOTHING highlighted. Ends with "step22b OK".
-- Production: run BEFORE deploying the C4b backend. Safe to run twice.
--
--  Device link (§9.4): the old phone makes an 8-character code (10 minutes, single use); the new phone redeems it,
--    joins the SAME profile and gets its own key. It never gets more access than the old phone had.
--  Saved details (§10.3): only a phone VERIFIED for the customer (founder callback, C5) may change the customer's
--    saved name/address. Each change writes an append-only shop_customer_events row (which fields, never values).

begin;

create table if not exists public.shop_customer_events (
  id          bigint generated always as identity primary key,
  customer_id uuid not null references public.shop_customers (id) on delete cascade,
  event_type  text not null check (event_type in ('details_changed')),
  fields      text[] not null default '{}',
  profile_id  uuid references public.shop_access_profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists shop_customer_events_customer_idx on public.shop_customer_events (customer_id, id desc);

drop trigger if exists shop_customer_events_no_update on public.shop_customer_events;
create trigger shop_customer_events_no_update before update or delete on public.shop_customer_events
  for each row execute function public.shop_movements_append_only();

-- The old phone asks for a code. Any earlier unused code of this profile stops working.
create or replace function public.create_device_link_code(p_profile_id uuid, p_code_hash text) returns timestamptz
language plpgsql set search_path = public as $$
declare v_expires timestamptz := now() + interval '10 minutes';
begin
  if not exists (select 1 from public.shop_access_profiles where id = p_profile_id) then raise exception 'SHOP_FORBIDDEN'; end if;
  update public.shop_verification_codes set used_at = now()
   where purpose = 'DEVICE_LINK' and profile_id = p_profile_id and used_at is null;
  insert into public.shop_verification_codes (purpose, profile_id, code_hash, expires_at)
  values ('DEVICE_LINK', p_profile_id, p_code_hash, v_expires);
  return v_expires;
end $$;

-- The new phone redeems a code. Returns {"result": "LINKED", "profile_id", "key_id"} or a refusal code.
--   INVALID_CODE        wrong, expired or already used (one answer for all three)
--   SAME_PROFILE        this phone is already linked to that phone
--   HAS_OWN_ORDERS      this phone has orders of its own: link the other way round, so none disappear
create or replace function public.redeem_device_link(
  p_current_profile_id uuid, p_current_key_id uuid, p_code_hash text, p_new_key_hash text
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_code public.shop_verification_codes;
  v_key uuid;
begin
  select * into v_code from public.shop_verification_codes
   where purpose = 'DEVICE_LINK' and code_hash = p_code_hash and used_at is null and expires_at > now()
   for update;
  if not found then return jsonb_build_object('result', 'INVALID_CODE'); end if;
  if v_code.profile_id = p_current_profile_id then return jsonb_build_object('result', 'SAME_PROFILE'); end if;
  if exists (select 1 from public.orders where placed_by_profile_id = p_current_profile_id) then
    return jsonb_build_object('result', 'HAS_OWN_ORDERS');
  end if;

  update public.shop_verification_codes set used_at = now(), attempts = least(attempts + 1, 5) where id = v_code.id;
  insert into public.shop_access_keys (profile_id, key_hash) values (v_code.profile_id, p_new_key_hash) returning id into v_key;
  -- this phone's previous key stops working at once
  update public.shop_access_keys set revoked_at = now()
   where id = p_current_key_id and profile_id = p_current_profile_id and revoked_at is null;
  return jsonb_build_object('result', 'LINKED', 'profile_id', v_code.profile_id, 'key_id', v_key);
end $$;

-- A verified phone saves new default details for its customer (§10.3, D22).
create or replace function public.save_customer_details(p_profile_id uuid, p_details jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_customer public.shop_customers;
  v_fields text[] := '{}';
begin
  select c.* into v_customer
    from public.shop_profile_customers pc join public.shop_customers c on c.id = pc.customer_id
   where pc.profile_id = p_profile_id
   order by pc.verified_at desc limit 1
   for update of c;
  if not found then raise exception 'SHOP_NOT_VERIFIED'; end if;

  if btrim(p_details->>'name') is distinct from v_customer.display_name then v_fields := array_append(v_fields, 'name'); end if;
  if btrim(p_details->>'address_line1') is distinct from v_customer.address_line1 then v_fields := array_append(v_fields, 'address_line1'); end if;
  if coalesce(btrim(p_details->>'address_line2'), '') is distinct from v_customer.address_line2 then v_fields := array_append(v_fields, 'address_line2'); end if;
  if coalesce(btrim(p_details->>'landmark'), '') is distinct from v_customer.landmark then v_fields := array_append(v_fields, 'landmark'); end if;
  if coalesce(p_details->>'pincode', '') is distinct from v_customer.pincode then v_fields := array_append(v_fields, 'pincode'); end if;
  if cardinality(v_fields) = 0 then return jsonb_build_object('changed', '[]'::jsonb); end if;

  -- The phone number is the customer's identity and is not changed here.
  update public.shop_customers set
    display_name  = btrim(p_details->>'name'),
    address_line1 = btrim(p_details->>'address_line1'),
    address_line2 = coalesce(btrim(p_details->>'address_line2'), ''),
    landmark      = coalesce(btrim(p_details->>'landmark'), ''),
    pincode       = coalesce(p_details->>'pincode', ''),
    details_verified_at = now()
  where id = v_customer.id;
  insert into public.shop_customer_events (customer_id, event_type, fields, profile_id)
  values (v_customer.id, 'details_changed', v_fields, p_profile_id);
  return jsonb_build_object('changed', to_jsonb(v_fields));
end $$;

-- SQL-editor convenience: the same orders, money shown in rupees (480.00). Storage stays in paise.
create or replace view public.orders_in_rupees as
select order_number,
       status,
       payment_status,
       to_char(subtotal_paise / 100.0, 'FM999999990.00') as subtotal_rupees,
       to_char(total_paise / 100.0, 'FM999999990.00') as total_rupees,
       to_char(cod_collected_paise / 100.0, 'FM999999990.00') as cod_collected_rupees,
       customer_name,
       same_day_state,
       created_at at time zone 'Asia/Kolkata' as created_ist,
       id
from public.orders;

alter table public.shop_customer_events enable row level security;
revoke all on table public.shop_customer_events, public.orders_in_rupees from anon, authenticated;
revoke all on sequence public.shop_customer_events_id_seq from anon, authenticated;
revoke execute on function
  public.create_device_link_code(uuid, text),
  public.redeem_device_link(uuid, uuid, text, text),
  public.save_customer_details(uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.create_device_link_code(uuid, text),
  public.redeem_device_link(uuid, uuid, text, text),
  public.save_customer_details(uuid, jsonb)
to service_role;

do $$
begin
  if to_regclass('public.orders') is null then raise exception 'step22b check failed: run step23 first.'; end if;
  if to_regprocedure('public.redeem_device_link(uuid,uuid,text,text)') is null
     or to_regclass('public.orders_in_rupees') is null then
    raise exception 'step22b check failed: something is missing. Run the WHOLE file with nothing selected.';
  end if;
  if has_table_privilege('anon', 'public.orders_in_rupees', 'select') then
    raise exception 'step22b check failed: the rupees view is readable by anon.';
  end if;
  raise notice 'step22b OK';
end $$;

commit;
