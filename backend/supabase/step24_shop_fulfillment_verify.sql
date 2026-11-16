-- step24_shop_fulfillment_verify.sql — run after step24. Read-only. Every row must say true.
with f(sig) as (values
  ('shop_transition_order(uuid,uuid,text,text,text,jsonb,jsonb,boolean)'),
  ('record_cod_collection(uuid,uuid,integer,text)'),
  ('set_delivery_expectation(uuid,uuid,date,text,text)'),
  ('claim_due_placed_reminders()'))
select 'all 4 fulfillment functions exist' as check,
       (select bool_and(to_regprocedure('public.' || sig) is not null) from f) as ok
union all
select 'service_role only (anon/authenticated cannot run them)',
       (select bool_and(has_function_privilege('service_role', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('anon', to_regprocedure('public.' || sig), 'execute')
                    and not has_function_privilege('authenticated', to_regprocedure('public.' || sig), 'execute')) from f)
union all
select 'reminders never change an order''s status (claim touches only reminder columns)',
       position('status =' in pg_get_functiondef('public.claim_due_placed_reminders()'::regprocedure)) > 0
   and position('set last_placed_reminder_at' in pg_get_functiondef('public.claim_due_placed_reminders()'::regprocedure)) > 0
   and position('set status' in pg_get_functiondef('public.claim_due_placed_reminders()'::regprocedure)) = 0;
