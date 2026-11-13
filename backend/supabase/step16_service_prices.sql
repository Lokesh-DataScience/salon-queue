-- step16_service_prices.sql
-- Customer app, polish slice 2: an optional price for each salon service.
-- NULL = the barber has not set a price; the customer app then shows no price for it.
-- Whole rupees only (no paise). Additive and idempotent: safe on a live database and safe to re-run.
-- Run in the Supabase SQL editor with NOTHING highlighted.

alter table public.salon_services
  add column if not exists price_rupees integer;

do $$ begin
  alter table public.salon_services
    add constraint salon_services_price_rupees_range
    check (price_rupees is null or (price_rupees >= 0 and price_rupees <= 100000));
exception when duplicate_object then null; end $$;

-- ── Self-check ───────────────────────────────────────────────────────────
do $$
declare
  v_col int;
  v_chk int;
begin
  select count(*) into v_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'salon_services' and column_name = 'price_rupees'
    and data_type = 'integer' and is_nullable = 'YES';

  select count(*) into v_chk
  from pg_constraint
  where conname = 'salon_services_price_rupees_range';

  if v_col <> 1 then raise exception 'step16 FAILED: salon_services.price_rupees missing or wrong type'; end if;
  if v_chk <> 1 then raise exception 'step16 FAILED: price range check missing'; end if;
end $$;

select 'step16 OK' as result;
