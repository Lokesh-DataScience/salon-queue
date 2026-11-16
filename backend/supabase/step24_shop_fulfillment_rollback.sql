-- step24_shop_fulfillment_rollback.sql — undo step24. Removes the fulfilment FUNCTIONS only: orders, their
-- statuses, events and stock movements stay exactly as they are (nothing is deleted).
-- Run only together with rolling the backend back to C4b (the C5a backend calls these functions).
begin;
drop function if exists public.claim_due_placed_reminders();
drop function if exists public.set_delivery_expectation(uuid, uuid, date, text, text);
drop function if exists public.record_cod_collection(uuid, uuid, integer, text);
drop function if exists public.shop_transition_order(uuid, uuid, text, text, text, jsonb, jsonb, boolean);
drop function if exists public.shop_line_movement(uuid, uuid, public.order_items, text, text);
do $$ begin raise notice 'step24 rolled back (order data untouched)'; end $$;
commit;
