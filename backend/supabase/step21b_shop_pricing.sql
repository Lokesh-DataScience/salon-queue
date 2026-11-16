-- backend/supabase/step21b_shop_pricing.sql — Commerce Phase 1, C3: server-side cart pricing (§8.1).
-- Run on the TESTS project first, with NOTHING highlighted. Ends with "step21b OK". Then run
-- step21b_shop_pricing_verify.sql (every row true). Production: run BEFORE deploying the C3 backend.
-- Safe to run twice. Reads only: nothing here changes stock or creates orders.
--
--   shop_price_lines(items, products, settings, now_ist)  PURE: reads no tables. The single place that
--       decides prices, limits and availability. place_order (C4, step23) calls it with LOCKED rows.
--   price_cart(items)   quote only: reads current rows without locks and reserves nothing.
--
-- items:    [{"product_id": uuid, "qty": int}, ...]   (1–20 different products, qty 1–20 each)
-- Problems per line (code only, no customer data):
--   UNAVAILABLE       product unknown, deleted, switched off or hidden
--   NOT_ENOUGH_STOCK  qty > units customers can buy (on hand − reserved − buffer); max_qty says how many
--   OVER_LIMIT        qty > the product's max per order; max_qty says the limit
-- Order-level: OVER_COD_LIMIT when the total is above the cash-on-delivery limit in Shop settings.

begin;

create or replace function public.shop_price_lines(
  p_items jsonb, p_products jsonb, p_settings jsonb, p_now_ist time
) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_item jsonb;
  v_p jsonb;
  v_qty integer;
  v_sellable integer;
  v_max integer;
  v_problem text;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_problems integer := 0;
  v_all_same_day boolean := true;
  v_cutoff time;
  v_cod_max integer;
  v_order_problems jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'SHOP_INVALID_CART';
  end if;
  if (select count(distinct e->>'product_id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
    raise exception 'SHOP_DUPLICATE_ITEM';
  end if;

  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item->'qty') <> 'number' then raise exception 'SHOP_INVALID_CART'; end if;
    v_qty := (v_item->>'qty')::integer;
    if v_qty < 1 or v_qty > 20 then raise exception 'SHOP_INVALID_CART'; end if;

    select e into v_p from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) e
     where e->>'id' = v_item->>'product_id' limit 1;

    v_problem := null;
    v_max := null;
    if v_p is null
       or (v_p->>'deleted_at') is not null
       or not coalesce((v_p->>'is_active')::boolean, false)
       or not coalesce((v_p->>'is_visible')::boolean, false) then
      v_problem := 'UNAVAILABLE';
    else
      v_sellable := greatest(0, (v_p->>'stock_on_hand')::integer - (v_p->>'stock_reserved')::integer
                                - (v_p->>'stock_buffer')::integer);
      if v_qty > (v_p->>'max_per_order')::integer then
        v_problem := 'OVER_LIMIT';
        v_max := least((v_p->>'max_per_order')::integer, v_sellable);
      elsif v_qty > v_sellable then
        v_problem := 'NOT_ENOUGH_STOCK';
        v_max := v_sellable;
      end if;
    end if;

    if v_problem is not null then
      v_problems := v_problems + 1;
      v_lines := v_lines || jsonb_build_object(
        'product_id', v_item->>'product_id', 'qty', v_qty, 'problem', v_problem, 'max_qty', v_max,
        'unit_price_paise', case when v_problem = 'UNAVAILABLE' then null else (v_p->>'selling_price_paise')::integer end,
        'mrp_paise', case when v_problem = 'UNAVAILABLE' then null else (v_p->>'mrp_paise')::integer end,
        'line_total_paise', null);
    else
      v_subtotal := v_subtotal + (v_p->>'selling_price_paise')::bigint * v_qty;
      v_all_same_day := v_all_same_day and coalesce((v_p->>'same_day_eligible')::boolean, false);
      v_lines := v_lines || jsonb_build_object(
        'product_id', v_item->>'product_id', 'qty', v_qty, 'problem', null, 'max_qty', null,
        'unit_price_paise', (v_p->>'selling_price_paise')::integer,
        'mrp_paise', (v_p->>'mrp_paise')::integer,
        'line_total_paise', (v_p->>'selling_price_paise')::integer * v_qty);
    end if;
  end loop;

  v_cod_max := (p_settings->>'cod_max_order_paise')::integer;
  if v_cod_max is not null and v_subtotal > v_cod_max then
    v_order_problems := v_order_problems || to_jsonb('OVER_COD_LIMIT'::text);
  end if;
  v_cutoff := nullif(p_settings->>'same_day_cutoff', '')::time;

  return jsonb_build_object(
    'lines', v_lines,
    'subtotal_paise', v_subtotal,
    'delivery_fee_paise', 0,                -- D10: no delivery fee
    'total_paise', v_subtotal,
    'line_problems', v_problems,
    'order_problems', v_order_problems,
    'cod_max_order_paise', v_cod_max,
    'ok', v_problems = 0 and jsonb_array_length(v_order_problems) = 0,
    -- Same-day can only be REQUESTED here, never promised (D3): switch on, before cutoff, every item eligible.
    'same_day_requestable', v_cutoff is not null and p_now_ist < v_cutoff and v_all_same_day and v_problems = 0
  );
end $$;

-- Quote only. Reads current rows without locks; reserves nothing.
create or replace function public.price_cart(p_items jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_products jsonb;
  v_settings jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'SHOP_INVALID_CART'; end if;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_products
    from public.products p
   where p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(p_items) e);
  select to_jsonb(s) into v_settings from public.shop_settings s where s.id;
  return public.shop_price_lines(p_items, v_products, v_settings, (now() at time zone 'Asia/Kolkata')::time);
end $$;

revoke execute on function public.shop_price_lines(jsonb, jsonb, jsonb, time), public.price_cart(jsonb)
  from public, anon, authenticated;
grant execute on function public.shop_price_lines(jsonb, jsonb, jsonb, time), public.price_cart(jsonb) to service_role;

do $$
begin
  if to_regprocedure('public.shop_price_lines(jsonb,jsonb,jsonb,time)') is null
     or to_regprocedure('public.price_cart(jsonb)') is null then
    raise exception 'step21b check failed: function missing. Run the WHOLE file with nothing selected.';
  end if;
  if to_regclass('public.products') is null then
    raise exception 'step21b check failed: run step21_shop_catalog.sql first.';
  end if;
  raise notice 'step21b OK';
end $$;

commit;
