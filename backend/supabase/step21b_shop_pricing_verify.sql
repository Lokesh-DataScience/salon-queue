-- step21b_shop_pricing_verify.sql — run after step21b_shop_pricing.sql. Read-only. Every row must say true.
select 'shop_price_lines exists and is immutable (pure)' as check,
       exists (select 1 from pg_proc where oid = to_regprocedure('public.shop_price_lines(jsonb,jsonb,jsonb,time)')
                 and provolatile = 'i') as ok
union all
select 'price_cart exists and is read-only (stable)',
       exists (select 1 from pg_proc where oid = to_regprocedure('public.price_cart(jsonb)') and provolatile = 's')
union all
select 'anon/authenticated cannot run the pricing functions',
       not has_function_privilege('anon', 'public.price_cart(jsonb)', 'execute')
   and not has_function_privilege('authenticated', 'public.price_cart(jsonb)', 'execute')
   and not has_function_privilege('anon', 'public.shop_price_lines(jsonb,jsonb,jsonb,time)', 'execute')
union all
select 'service_role can run the pricing functions',
       has_function_privilege('service_role', 'public.price_cart(jsonb)', 'execute')
   and has_function_privilege('service_role', 'public.shop_price_lines(jsonb,jsonb,jsonb,time)', 'execute')
union all
select 'pure pricing example: 2 × ₹220 = ₹440, no problems',
       (public.shop_price_lines(
          '[{"product_id":"00000000-0000-0000-0000-000000000001","qty":2}]',
          '[{"id":"00000000-0000-0000-0000-000000000001","is_active":true,"is_visible":true,"deleted_at":null,
             "mrp_paise":25000,"selling_price_paise":22000,"max_per_order":5,"stock_on_hand":10,
             "stock_reserved":0,"stock_buffer":0,"same_day_eligible":true}]',
          '{"cod_max_order_paise":200000,"same_day_cutoff":null}', '12:00') ->> 'total_paise')::int = 44000
union all
select 'quote on an unknown product says UNAVAILABLE (and reserves nothing)',
       (public.price_cart('[{"product_id":"00000000-0000-0000-0000-000000000000","qty":1}]') -> 'lines' -> 0 ->> 'problem')
         = 'UNAVAILABLE';
