-- c7_pilot_readiness.sql — Commerce C7: is PRODUCTION ready for the pilot? Read-only: changes nothing.
-- Run in the production SQL editor before switching the shop on. Every row must say ready = true
-- (rows marked "info" are for you to read; they never block).
with
  roles as (select r.staff_id, r.role from public.staff_admin_roles r where r.role in ('FOUNDER', 'COFOUNDER')),
  s as (select * from public.shop_settings where id),
  sup as (select * from public.suppliers where is_active),
  sellable as (
    select p.id, exists (select 1 from public.product_images i where i.product_id = p.id) as has_photo
      from public.products p
     where p.is_visible and p.deleted_at is null and p.stock_on_hand - p.stock_reserved - p.stock_buffer > 0)
select 1 as n, 'All shop migrations step21–step25 are on this database' as check,
       to_regprocedure('public.price_cart(jsonb)') is not null
   and to_regprocedure('public.place_order(uuid,uuid,text,jsonb,integer,jsonb,boolean,boolean,jsonb)') is not null
   and to_regprocedure('public.redeem_device_link(uuid,uuid,text,text)') is not null
   and to_regprocedure('public.claim_due_placed_reminders()') is not null
   and to_regprocedure('public.revoke_access_key(uuid,uuid,uuid)') is not null
   and to_regprocedure('public.mark_refund_paid(uuid,uuid,text)') is not null as ready
union all
select 2, 'One active supplier, with a phone number (for WhatsApp)',
       (select count(*) = 1 and bool_and(char_length(coalesce(phone, '')) >= 10) from sup)
union all
select 3, 'Shop phone set (customers call it; shown on orders and recovery)',
       (select char_length(coalesce(founder_contact_phone, '')) >= 10 from s)
union all
select 4, 'COD limit and open-order limit set (Q7: ₹2,000 and 2)',
       (select cod_max_order_paise > 0 and max_open_cod_orders_per_customer > 0 from s)
union all
select 5, 'At least 5 products customers can buy now',
       (select count(*) >= 5 from sellable)
union all
select 6, 'Every one of them has a photo',
       (select coalesce(bool_and(has_photo), false) from sellable)
union all
select 7, 'A founder account exists',
       exists (select 1 from roles where role = 'FOUNDER')
union all
select 8, 'Founder has new-order alerts switched on (at least one phone)',
       exists (select 1 from public.staff_push_subscriptions ps join roles r on r.staff_id = ps.staff_id where r.role = 'FOUNDER')
union all
select 9, 'At least one salon is marked internal (the pilot starts there)',
       exists (select 1 from public.salons where is_internal)
union all
select 10, 'No test orders left over (or you know about them)',
       not exists (select 1 from public.orders where status not in ('DELIVERED', 'CANCELLED'))
union all
select 11, 'info: shop switched on? (turn on as the LAST step)',
       coalesce((select enabled from public.feature_flags where key = 'shop_enabled'), false)
union all
select 12, 'info: strip shown at internal salons only (keep "internal" for week 1)',
       coalesce((select value = 'internal' from public.feature_flags where key = 'shop_enabled'), false)
union all
select 13, 'info: same-day delivery switched on (needs a cutoff time in Shop settings)',
       (select same_day_cutoff is not null from s)
order by n;
