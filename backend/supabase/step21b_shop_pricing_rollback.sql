-- step21b_shop_pricing_rollback.sql — undoes step21b. Only before step23 (orders) exists, which calls it.
begin;
drop function if exists public.price_cart(jsonb);
drop function if exists public.shop_price_lines(jsonb, jsonb, jsonb, time);
do $$ begin raise notice 'step21b rollback OK'; end $$;
commit;
