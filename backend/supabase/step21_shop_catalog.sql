-- backend/supabase/step21_shop_catalog.sql — Commerce Phase 1, C1: catalog, stock, stock history, settings.
-- Run on the TESTS project first, with NOTHING highlighted in the editor. Ends with "step21 OK".
-- Then run step21_shop_catalog_verify.sql (every row must say true). Production only after tests verify.
-- Production: run this whole file BEFORE deploying the matching backend. Safe to run twice.
--
-- Rules (COMMERCE_PHASE1_PLAN_FINAL.md §4, §6, §7.5):
--  - Backend only: RLS on, no policies, no grants for anon/authenticated, RPCs executable by service_role only.
--  - Money is integer paise. Selling price must be below MRP.
--  - Stock changes ONLY through the shop_* stock functions, each writing an append-only movement row.
--  - Every write function re-checks in the database that the actor is an active FOUNDER (cofounder is read-only).
--  - Staff references in shop tables are ON DELETE RESTRICT (D19).
--  - Error messages raised here are short codes (SHOP_*), never customer data. The backend maps them.

begin;

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  phone       text not null default '' check (char_length(phone) <= 20),
  notes       text not null default '' check (char_length(notes) <= 1000),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Phase 1 has exactly one active supplier.
create unique index if not exists suppliers_one_active on public.suppliers ((true)) where is_active;

create table if not exists public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  name_en     text not null check (char_length(btrim(name_en)) between 1 and 60),
  name_hi     text not null default '' check (char_length(name_hi) <= 60),
  sort_order  integer not null default 0 check (sort_order between 0 and 1000),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.products (
  id                    uuid primary key default gen_random_uuid(),
  supplier_id           uuid not null references public.suppliers (id) on delete restrict,
  category_id           uuid references public.product_categories (id) on delete set null,
  sku                   text not null check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  name                  text not null check (char_length(btrim(name)) between 2 and 120),
  description           text not null default '' check (char_length(description) <= 2000),
  brand                 text not null default '' check (char_length(brand) <= 60),
  mrp_paise             integer not null check (mrp_paise > 0),
  selling_price_paise   integer not null check (selling_price_paise > 0),
  wholesale_cost_paise  integer not null check (wholesale_cost_paise >= 0),
  stock_on_hand         integer not null default 0 check (stock_on_hand >= 0),
  stock_reserved        integer not null default 0 check (stock_reserved >= 0),
  stock_buffer          integer not null default 0 check (stock_buffer between 0 and 1000),
  max_per_order         integer not null default 5 check (max_per_order between 1 and 20),
  is_active             boolean not null default true,
  is_visible            boolean not null default false,
  same_day_eligible     boolean not null default true,
  last_stock_check_at   timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint products_price_below_mrp check (selling_price_paise < mrp_paise),
  constraint products_reserved_le_on_hand check (stock_reserved <= stock_on_hand),
  constraint products_visible_needs_active check (not is_visible or (is_active and deleted_at is null))
);
-- One live product per SKU (case-insensitive). Soft-deleted products free their SKU.
create unique index if not exists products_sku_live_uq on public.products (lower(sku)) where deleted_at is null;
create index if not exists products_catalog_idx on public.products (category_id) where is_visible;
create index if not exists products_supplier_idx on public.products (supplier_id);

create table if not exists public.product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  storage_path  text not null unique check (storage_path ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  sort_order    integer not null default 0 check (sort_order between 0 and 100),
  alt           text not null default '' check (char_length(alt) <= 120),
  created_at    timestamptz not null default now()
);
create index if not exists product_images_product_idx on public.product_images (product_id, sort_order);

create table if not exists public.shop_settings (
  id                                boolean primary key default true check (id),
  same_day_cutoff                   time,  -- null = same-day off (Q6)
  seller_profile                    jsonb not null default '{}'::jsonb,
  cod_max_order_paise               integer not null default 200000 check (cod_max_order_paise between 10000 and 5000000),
  max_open_cod_orders_per_customer  integer not null default 2 check (max_open_cod_orders_per_customer between 1 and 10),
  founder_contact_phone             text not null default '' check (char_length(founder_contact_phone) <= 20),
  placed_reminder_after_minutes     integer not null default 30 check (placed_reminder_after_minutes between 1 and 1440),
  placed_reminder_repeat_minutes    integer not null default 120 check (placed_reminder_repeat_minutes between 5 and 1440),
  updated_at                        timestamptz not null default now()
);
insert into public.shop_settings (id) values (true) on conflict (id) do nothing;

-- Append-only stock history. step23/step25 add order/return references and widen the type check.
create table if not exists public.inventory_movements (
  id               bigint generated always as identity primary key,
  product_id       uuid not null references public.products (id) on delete restrict,
  movement_type    text not null,
  qty_change       integer not null,
  on_hand_before   integer not null check (on_hand_before >= 0),
  on_hand_after    integer not null check (on_hand_after >= 0),
  reserved_before  integer not null check (reserved_before >= 0),
  reserved_after   integer not null check (reserved_after >= 0),
  reason           text not null default '' check (char_length(reason) <= 300),
  actor_type       text not null check (actor_type in ('STAFF', 'CUSTOMER', 'SYSTEM')),
  actor_staff_id   uuid references public.salon_staff (id) on delete restrict,
  created_at       timestamptz not null default now(),
  constraint inventory_movements_type_check
    check (movement_type in ('INITIAL_STOCK', 'STOCK_COUNT', 'MANUAL_ADJUSTMENT', 'DAMAGED_STOCK')),
  -- Product-level movements change on-hand only. (step23 replaces this for order-line types.)
  constraint inventory_movements_product_level_check check (
    on_hand_after = on_hand_before + qty_change
    and reserved_after = reserved_before
    and qty_change <> 0
    and (movement_type <> 'INITIAL_STOCK' or qty_change > 0)
    and (movement_type <> 'DAMAGED_STOCK' or qty_change < 0)
  ),
  constraint inventory_movements_staff_actor check (actor_type <> 'STAFF' or actor_staff_id is not null)
);
create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id, id desc);

-- Starter categories (editable later). Not customer data.
insert into public.product_categories (slug, name_en, name_hi, sort_order) values
  ('hair-care',  'Hair care',  'बालों की देखभाल', 10),
  ('beard-care', 'Beard care', 'दाढ़ी की देखभाल', 20),
  ('skin-care',  'Skin care',  'त्वचा की देखभाल', 30),
  ('styling',    'Styling',    'स्टाइलिंग',        40),
  ('other',      'Other',      'अन्य',             90)
on conflict (slug) do nothing;

-- The one supplier (D1). Name and phone are edited from Shop settings.
insert into public.suppliers (name)
select 'Main supplier' where not exists (select 1 from public.suppliers where is_active);

-- ── Triggers ──────────────────────────────────────────────────────────────

create or replace function public.shop_movements_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'SHOP_HISTORY_IMMUTABLE';
end $$;

drop trigger if exists inventory_movements_no_update on public.inventory_movements;
create trigger inventory_movements_no_update before update or delete on public.inventory_movements
  for each row execute function public.shop_movements_append_only();
drop trigger if exists inventory_movements_no_truncate on public.inventory_movements;
create trigger inventory_movements_no_truncate before truncate on public.inventory_movements
  for each statement execute function public.shop_movements_append_only();

-- Stock columns may only change inside the shop_* stock functions (which set shop.stock_write).
create or replace function public.shop_guard_stock_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('shop.stock_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.stock_on_hand <> 0 or new.stock_reserved <> 0 then
      raise exception 'SHOP_STOCK_VIA_FUNCTION';
    end if;
  elsif new.stock_on_hand is distinct from old.stock_on_hand
     or new.stock_reserved is distinct from old.stock_reserved then
    raise exception 'SHOP_STOCK_VIA_FUNCTION';
  end if;
  return new;
end $$;

drop trigger if exists products_guard_stock on public.products;
create trigger products_guard_stock before insert or update on public.products
  for each row execute function public.shop_guard_stock_columns();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
drop trigger if exists product_categories_set_updated_at on public.product_categories;
create trigger product_categories_set_updated_at before update on public.product_categories
  for each row execute function public.set_updated_at();
drop trigger if exists shop_settings_set_updated_at on public.shop_settings;
create trigger shop_settings_set_updated_at before update on public.shop_settings
  for each row execute function public.set_updated_at();

-- ── Functions (service_role only) ─────────────────────────────────────────

-- Raises unless p_actor is an ACTIVE staff member with the FOUNDER admin role.
create or replace function public.shop_require_founder(p_actor uuid) returns void
language plpgsql set search_path = public as $$
begin
  if p_actor is null or not exists (
    select 1 from public.staff_admin_roles r
    join public.salon_staff s on s.id = r.staff_id
    where r.staff_id = p_actor and r.role = 'FOUNDER' and s.is_active
  ) then
    raise exception 'SHOP_FORBIDDEN';
  end if;
end $$;

-- Internal: one product-level stock change + its movement row. Caller holds the row lock.
create or replace function public.shop_apply_stock_change(
  p_actor uuid, p_product public.products, p_type text, p_new_on_hand integer, p_reason text
) returns void
language plpgsql set search_path = public as $$
begin
  if p_new_on_hand < 0 then raise exception 'SHOP_INVALID_QTY'; end if;
  if p_new_on_hand < p_product.stock_reserved then raise exception 'SHOP_BELOW_RESERVED'; end if;
  if p_new_on_hand = p_product.stock_on_hand then return; end if;

  perform set_config('shop.stock_write', 'on', true);
  update public.products set stock_on_hand = p_new_on_hand where id = p_product.id;
  perform set_config('shop.stock_write', 'off', true);

  insert into public.inventory_movements
    (product_id, movement_type, qty_change, on_hand_before, on_hand_after,
     reserved_before, reserved_after, reason, actor_type, actor_staff_id)
  values
    (p_product.id, p_type, p_new_on_hand - p_product.stock_on_hand, p_product.stock_on_hand, p_new_on_hand,
     p_product.stock_reserved, p_product.stock_reserved, coalesce(p_reason, ''), 'STAFF', p_actor);
end $$;

-- Create (p_product_id null) or update a product's non-stock fields. Returns the product id.
-- p_fields keys: category_id, sku, name, description, brand, mrp_paise, selling_price_paise,
-- wholesale_cost_paise, stock_buffer, max_per_order, is_active, is_visible, same_day_eligible.
create or replace function public.shop_save_product(
  p_actor uuid, p_product_id uuid, p_fields jsonb, p_initial_stock integer default 0
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_row public.products;
  v_supplier uuid;
begin
  perform public.shop_require_founder(p_actor);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'SHOP_INVALID_INPUT'; end if;

  if p_product_id is null then
    if coalesce(p_initial_stock, 0) < 0 then raise exception 'SHOP_INVALID_QTY'; end if;
    select id into v_supplier from public.suppliers where is_active;
    if v_supplier is null then raise exception 'SHOP_NO_SUPPLIER'; end if;

    insert into public.products (
      supplier_id, category_id, sku, name, description, brand,
      mrp_paise, selling_price_paise, wholesale_cost_paise,
      stock_buffer, max_per_order, is_active, is_visible, same_day_eligible
    ) values (
      v_supplier,
      nullif(p_fields->>'category_id', '')::uuid,
      p_fields->>'sku',
      btrim(p_fields->>'name'),
      coalesce(p_fields->>'description', ''),
      coalesce(p_fields->>'brand', ''),
      (p_fields->>'mrp_paise')::integer,
      (p_fields->>'selling_price_paise')::integer,
      (p_fields->>'wholesale_cost_paise')::integer,
      coalesce((p_fields->>'stock_buffer')::integer, 0),
      coalesce((p_fields->>'max_per_order')::integer, 5),
      coalesce((p_fields->>'is_active')::boolean, true),
      false, -- new products start hidden; the founder shows them once images and stock are ready
      coalesce((p_fields->>'same_day_eligible')::boolean, true)
    ) returning * into v_row;

    if coalesce(p_initial_stock, 0) > 0 then
      perform public.shop_apply_stock_change(p_actor, v_row, 'INITIAL_STOCK', p_initial_stock, 'Initial stock');
      update public.products set last_stock_check_at = now() where id = v_row.id;
    end if;
    return v_row.id;
  end if;

  select * into v_row from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;

  update public.products set
    category_id          = case when p_fields ? 'category_id' then nullif(p_fields->>'category_id', '')::uuid else category_id end,
    sku                  = case when p_fields ? 'sku' then p_fields->>'sku' else sku end,
    name                 = case when p_fields ? 'name' then btrim(p_fields->>'name') else name end,
    description          = case when p_fields ? 'description' then coalesce(p_fields->>'description', '') else description end,
    brand                = case when p_fields ? 'brand' then coalesce(p_fields->>'brand', '') else brand end,
    mrp_paise            = case when p_fields ? 'mrp_paise' then (p_fields->>'mrp_paise')::integer else mrp_paise end,
    selling_price_paise  = case when p_fields ? 'selling_price_paise' then (p_fields->>'selling_price_paise')::integer else selling_price_paise end,
    wholesale_cost_paise = case when p_fields ? 'wholesale_cost_paise' then (p_fields->>'wholesale_cost_paise')::integer else wholesale_cost_paise end,
    stock_buffer         = case when p_fields ? 'stock_buffer' then (p_fields->>'stock_buffer')::integer else stock_buffer end,
    max_per_order        = case when p_fields ? 'max_per_order' then (p_fields->>'max_per_order')::integer else max_per_order end,
    is_active            = case when p_fields ? 'is_active' then (p_fields->>'is_active')::boolean else is_active end,
    same_day_eligible    = case when p_fields ? 'same_day_eligible' then (p_fields->>'same_day_eligible')::boolean else same_day_eligible end,
    -- switching a product off also hides it (products_visible_needs_active)
    is_visible           = case when p_fields ? 'is_active' and not (p_fields->>'is_active')::boolean then false else is_visible end
  where id = p_product_id;
  return p_product_id;
end $$;

-- Show / hide in the customer catalog ("instant unavailable", D4). Showing also re-activates.
create or replace function public.shop_set_product_visibility(p_actor uuid, p_product_id uuid, p_visible boolean)
returns void
language plpgsql set search_path = public as $$
begin
  perform public.shop_require_founder(p_actor);
  update public.products
     set is_visible = p_visible, is_active = case when p_visible then true else is_active end
   where id = p_product_id and deleted_at is null;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
end $$;

-- Soft delete. History stays; the SKU becomes free. Refused while units are reserved by orders.
create or replace function public.shop_delete_product(p_actor uuid, p_product_id uuid) returns void
language plpgsql set search_path = public as $$
declare v_row public.products;
begin
  perform public.shop_require_founder(p_actor);
  select * into v_row from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if v_row.stock_reserved > 0 then raise exception 'SHOP_HAS_RESERVATIONS'; end if;
  update public.products set deleted_at = now(), is_visible = false, is_active = false where id = p_product_id;
end $$;

-- One stock change from the product page.
--   STOCK_COUNT:        p_qty = the counted on-hand quantity
--   MANUAL_ADJUSTMENT:  p_qty = +/- change (not 0), reason required
--   DAMAGED_STOCK:      p_qty = number of damaged units (> 0), reason required
-- p_expected_on_hand is what the founder's screen showed; a different value means a stale screen.
create or replace function public.shop_adjust_stock(
  p_actor uuid, p_product_id uuid, p_type text, p_qty integer, p_expected_on_hand integer, p_reason text
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_row public.products;
  v_new integer;
begin
  perform public.shop_require_founder(p_actor);
  if p_type not in ('STOCK_COUNT', 'MANUAL_ADJUSTMENT', 'DAMAGED_STOCK') or p_qty is null then
    raise exception 'SHOP_INVALID_INPUT';
  end if;
  if p_type <> 'STOCK_COUNT' and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'SHOP_REASON_REQUIRED';
  end if;

  select * into v_row from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if p_expected_on_hand is distinct from v_row.stock_on_hand then raise exception 'SHOP_STALE'; end if;

  v_new := case p_type
             when 'STOCK_COUNT' then p_qty
             when 'MANUAL_ADJUSTMENT' then v_row.stock_on_hand + p_qty
             else v_row.stock_on_hand - p_qty
           end;
  if (p_type = 'MANUAL_ADJUSTMENT' and p_qty = 0) or (p_type = 'DAMAGED_STOCK' and p_qty <= 0) then
    raise exception 'SHOP_INVALID_QTY';
  end if;

  perform public.shop_apply_stock_change(p_actor, v_row, p_type, v_new, btrim(coalesce(p_reason, '')));
  if p_type = 'STOCK_COUNT' then
    update public.products set last_stock_check_at = now() where id = p_product_id;
  end if;

  select * into v_row from public.products where id = p_product_id;
  return jsonb_build_object('stock_on_hand', v_row.stock_on_hand, 'stock_reserved', v_row.stock_reserved);
end $$;

-- Daily stock check (D4): p_items = [{"product_id": uuid, "counted": int, "expected_on_hand": int}, ...].
-- All or nothing: one stale row and nothing is saved. Unchanged counts only update last_stock_check_at.
create or replace function public.shop_stock_check(p_actor uuid, p_items jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_item jsonb;
  v_row public.products;
  v_checked integer := 0;
  v_changed integer := 0;
begin
  perform public.shop_require_founder(p_actor);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 500 then
    raise exception 'SHOP_INVALID_INPUT';
  end if;
  if (select count(distinct e->>'product_id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
    raise exception 'SHOP_DUPLICATE_ITEM';
  end if;

  -- Lock in ascending id (the shop-wide lock order, §8.2).
  for v_item in
    select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid
  loop
    select * into v_row from public.products
     where id = (v_item->>'product_id')::uuid and deleted_at is null for update;
    if not found then raise exception 'SHOP_NOT_FOUND'; end if;
    if (v_item->>'expected_on_hand')::integer is distinct from v_row.stock_on_hand then
      raise exception 'SHOP_STALE';
    end if;
    if (v_item->>'counted') is null then raise exception 'SHOP_INVALID_QTY'; end if;
    if (v_item->>'counted')::integer <> v_row.stock_on_hand then
      v_changed := v_changed + 1;
    end if;
    perform public.shop_apply_stock_change(p_actor, v_row, 'STOCK_COUNT', (v_item->>'counted')::integer, 'Daily stock check');
    update public.products set last_stock_check_at = now() where id = v_row.id;
    v_checked := v_checked + 1;
  end loop;

  return jsonb_build_object('checked', v_checked, 'changed', v_changed);
end $$;

-- Create (p_id null) or update a category. p_fields keys: slug, name_en, name_hi, sort_order, is_active.
create or replace function public.shop_save_category(p_actor uuid, p_id uuid, p_fields jsonb) returns uuid
language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  perform public.shop_require_founder(p_actor);
  if p_id is null then
    insert into public.product_categories (slug, name_en, name_hi, sort_order, is_active)
    values (p_fields->>'slug', btrim(p_fields->>'name_en'), coalesce(p_fields->>'name_hi', ''),
            coalesce((p_fields->>'sort_order')::integer, 0), coalesce((p_fields->>'is_active')::boolean, true))
    returning id into v_id;
    return v_id;
  end if;
  update public.product_categories set
    slug       = case when p_fields ? 'slug' then p_fields->>'slug' else slug end,
    name_en    = case when p_fields ? 'name_en' then btrim(p_fields->>'name_en') else name_en end,
    name_hi    = case when p_fields ? 'name_hi' then coalesce(p_fields->>'name_hi', '') else name_hi end,
    sort_order = case when p_fields ? 'sort_order' then (p_fields->>'sort_order')::integer else sort_order end,
    is_active  = case when p_fields ? 'is_active' then (p_fields->>'is_active')::boolean else is_active end
  where id = p_id;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  return p_id;
end $$;

-- Register an uploaded image (max 6 per product). The backend checks the file exists first.
create or replace function public.shop_add_product_image(
  p_actor uuid, p_product_id uuid, p_storage_path text, p_alt text
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  v_next integer;
begin
  perform public.shop_require_founder(p_actor);
  perform 1 from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
  if (select count(*) from public.product_images where product_id = p_product_id) >= 6 then
    raise exception 'SHOP_TOO_MANY_IMAGES';
  end if;
  if p_storage_path not like 'products/' || p_product_id::text || '/%' then
    raise exception 'SHOP_INVALID_INPUT';
  end if;
  select coalesce(max(sort_order) + 1, 0) into v_next from public.product_images where product_id = p_product_id;
  insert into public.product_images (product_id, storage_path, sort_order, alt)
  values (p_product_id, p_storage_path, v_next, coalesce(p_alt, ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.shop_update_product_image(
  p_actor uuid, p_product_id uuid, p_image_id uuid, p_sort_order integer, p_alt text
) returns void
language plpgsql set search_path = public as $$
begin
  perform public.shop_require_founder(p_actor);
  update public.product_images
     set sort_order = coalesce(p_sort_order, sort_order), alt = coalesce(p_alt, alt)
   where id = p_image_id and product_id = p_product_id;
  if not found then raise exception 'SHOP_NOT_FOUND'; end if;
end $$;

-- Removes the row and returns the storage path, so the backend can delete the file afterwards.
create or replace function public.shop_delete_product_image(p_actor uuid, p_product_id uuid, p_image_id uuid)
returns text
language plpgsql set search_path = public as $$
declare v_path text;
begin
  perform public.shop_require_founder(p_actor);
  delete from public.product_images where id = p_image_id and product_id = p_product_id
  returning storage_path into v_path;
  if v_path is null then raise exception 'SHOP_NOT_FOUND'; end if;
  return v_path;
end $$;

-- p_fields keys: same_day_cutoff ("HH:MM" or null), cod_max_order_paise, max_open_cod_orders_per_customer,
-- founder_contact_phone, placed_reminder_after_minutes, placed_reminder_repeat_minutes.
create or replace function public.shop_update_settings(p_actor uuid, p_fields jsonb) returns void
language plpgsql set search_path = public as $$
begin
  perform public.shop_require_founder(p_actor);
  update public.shop_settings set
    same_day_cutoff = case when p_fields ? 'same_day_cutoff' then nullif(p_fields->>'same_day_cutoff', '')::time else same_day_cutoff end,
    cod_max_order_paise = case when p_fields ? 'cod_max_order_paise' then (p_fields->>'cod_max_order_paise')::integer else cod_max_order_paise end,
    max_open_cod_orders_per_customer = case when p_fields ? 'max_open_cod_orders_per_customer'
      then (p_fields->>'max_open_cod_orders_per_customer')::integer else max_open_cod_orders_per_customer end,
    founder_contact_phone = case when p_fields ? 'founder_contact_phone' then coalesce(p_fields->>'founder_contact_phone', '') else founder_contact_phone end,
    placed_reminder_after_minutes = case when p_fields ? 'placed_reminder_after_minutes'
      then (p_fields->>'placed_reminder_after_minutes')::integer else placed_reminder_after_minutes end,
    placed_reminder_repeat_minutes = case when p_fields ? 'placed_reminder_repeat_minutes'
      then (p_fields->>'placed_reminder_repeat_minutes')::integer else placed_reminder_repeat_minutes end
  where id;
end $$;

-- The one active supplier. p_fields keys: name, phone, notes.
create or replace function public.shop_update_supplier(p_actor uuid, p_fields jsonb) returns void
language plpgsql set search_path = public as $$
begin
  perform public.shop_require_founder(p_actor);
  update public.suppliers set
    name  = case when p_fields ? 'name' then btrim(p_fields->>'name') else name end,
    phone = case when p_fields ? 'phone' then coalesce(p_fields->>'phone', '') else phone end,
    notes = case when p_fields ? 'notes' then coalesce(p_fields->>'notes', '') else notes end
  where is_active;
  if not found then raise exception 'SHOP_NO_SUPPLIER'; end if;
end $$;

-- ── Storage: product photos (not personal data) ───────────────────────────
-- Public read; uploads only through backend-signed upload URLs (founder only). 2 MB, jpeg/png/webp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-product-images', 'shop-product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ── Lock down ─────────────────────────────────────────────────────────────

alter table public.suppliers enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.shop_settings enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on table public.suppliers, public.product_categories, public.products, public.product_images,
  public.shop_settings, public.inventory_movements from anon, authenticated;
revoke all on sequence public.inventory_movements_id_seq from anon, authenticated;

revoke execute on function
  public.shop_movements_append_only(), public.shop_guard_stock_columns(),
  public.shop_require_founder(uuid),
  public.shop_apply_stock_change(uuid, public.products, text, integer, text),
  public.shop_save_product(uuid, uuid, jsonb, integer),
  public.shop_set_product_visibility(uuid, uuid, boolean),
  public.shop_delete_product(uuid, uuid),
  public.shop_adjust_stock(uuid, uuid, text, integer, integer, text),
  public.shop_stock_check(uuid, jsonb),
  public.shop_save_category(uuid, uuid, jsonb),
  public.shop_add_product_image(uuid, uuid, text, text),
  public.shop_update_product_image(uuid, uuid, uuid, integer, text),
  public.shop_delete_product_image(uuid, uuid, uuid),
  public.shop_update_settings(uuid, jsonb),
  public.shop_update_supplier(uuid, jsonb)
from public, anon, authenticated;

-- Nested calls run as the caller (security invoker), so the two helpers need service_role too.
grant execute on function
  public.shop_require_founder(uuid),
  public.shop_apply_stock_change(uuid, public.products, text, integer, text),
  public.shop_save_product(uuid, uuid, jsonb, integer),
  public.shop_set_product_visibility(uuid, uuid, boolean),
  public.shop_delete_product(uuid, uuid),
  public.shop_adjust_stock(uuid, uuid, text, integer, integer, text),
  public.shop_stock_check(uuid, jsonb),
  public.shop_save_category(uuid, uuid, jsonb),
  public.shop_add_product_image(uuid, uuid, text, text),
  public.shop_update_product_image(uuid, uuid, uuid, integer, text),
  public.shop_delete_product_image(uuid, uuid, uuid),
  public.shop_update_settings(uuid, jsonb),
  public.shop_update_supplier(uuid, jsonb)
to service_role;

-- ── Self-check ────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
      ('suppliers','product_categories','products','product_images','shop_settings','inventory_movements')) <> 6 then
    raise exception 'step21 check failed: a table is missing. Run the WHOLE file with nothing selected.';
  end if;
  if (select count(*) from public.suppliers where is_active) <> 1 then
    raise exception 'step21 check failed: expected exactly one active supplier.';
  end if;
  if not exists (select 1 from public.shop_settings where id) then
    raise exception 'step21 check failed: shop_settings row missing.';
  end if;
  raise notice 'step21 OK';
end $$;

commit;
