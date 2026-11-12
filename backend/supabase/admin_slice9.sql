-- =====================================================================
-- Admin Pages — Slice 9: Tech tab — queue health
-- Run on the TESTS project first. Production only after the checkpoint passes.
-- Safe to re-run. Read-only: no tables are changed.
--
-- Checks (each returns up to 50 rows to look at):
--   duplicate_tokens  same token twice in one queue (last 7 days) — should never happen
--   double_serving    two customers SERVING at once in one barber's line — should never happen
--   overdue_serving   SERVING more than 2 minutes past its end time (the sweeper should have finished it)
--   stale_active      waiting/called/serving tickets left in a queue from an earlier day
--   stuck_paused      today's queue paused for 2+ hours with customers still waiting
-- Plus today's notification numbers. Token numbers and salon names only — no customer data.
-- "Today" = the database date, the same one join_queue uses for queues.
-- =====================================================================

create or replace function public.tech_queue_health()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
select jsonb_build_object(
  'checked_at', now(),

  'duplicate_tokens', coalesce((select jsonb_agg(x) from (
    select s.id as salon_id, s.name as salon, q.date, e.token_number as token, count(*) as copies
    from queue_entries e
    join queues q on q.id = e.queue_id
    join salons s on s.id = q.salon_id
    where q.date >= current_date - 7
    group by s.id, s.name, q.date, e.queue_id, e.token_number
    having count(*) > 1
    limit 50
  ) x), '[]'::jsonb),

  'double_serving', coalesce((select jsonb_agg(x) from (
    select s.id as salon_id, s.name as salon, q.date, count(*) as serving,
           array_agg(e.token_number order by e.token_number) as tokens
    from queue_entries e
    join queues q on q.id = e.queue_id
    join salons s on s.id = q.salon_id
    where e.status = 'SERVING'
    group by s.id, s.name, q.date, e.queue_id, e.lane_id
    having count(*) > 1
    limit 50
  ) x), '[]'::jsonb),

  'overdue_serving', coalesce((select jsonb_agg(x) from (
    select s.id as salon_id, s.name as salon, e.token_number as token,
           round(extract(epoch from (now() - e.ends_at)) / 60)::int as minutes_over
    from queue_entries e
    join queues q on q.id = e.queue_id
    join salons s on s.id = q.salon_id
    where e.status = 'SERVING' and e.ends_at is not null and e.ends_at < now() - interval '2 minutes'
    order by e.ends_at
    limit 50
  ) x), '[]'::jsonb),

  'stale_active', coalesce((select jsonb_agg(x) from (
    select s.id as salon_id, s.name as salon, q.date, count(*) as tickets
    from queue_entries e
    join queues q on q.id = e.queue_id
    join salons s on s.id = q.salon_id
    where q.date < current_date and e.status in ('WAITING', 'CALLED', 'SERVING')
    group by s.id, s.name, q.date
    order by q.date desc
    limit 50
  ) x), '[]'::jsonb),

  'stuck_paused', coalesce((select jsonb_agg(x) from (
    select s.id as salon_id, s.name as salon,
           (select count(*) from queue_entries w where w.queue_id = q.id and w.status = 'WAITING') as waiting,
           round(extract(epoch from (now() - q.updated_at)) / 60)::int as minutes_paused
    from queues q
    join salons s on s.id = q.salon_id
    where q.date = current_date and q.status = 'PAUSED' and q.updated_at < now() - interval '2 hours'
      and exists (select 1 from queue_entries w where w.queue_id = q.id and w.status = 'WAITING')
    limit 50
  ) x), '[]'::jsonb),

  'push_today', (
    select jsonb_build_object(
      'qr_tickets',     count(*) filter (where not coalesce(e.is_walk_in, false)),
      'with_push',      count(*) filter (where e.push_subscription is not null),
      'got_close',      count(*) filter (where coalesce(e.notified_stage, 0) >= 1),
      'got_next',       count(*) filter (where coalesce(e.notified_stage, 0) >= 2),
      'got_turn',       count(*) filter (where coalesce(e.notified_stage, 0) >= 3)
    )
    from queue_entries e
    join queues q on q.id = e.queue_id
    where q.date = current_date
  )
);
$function$;

revoke all on function public.tech_queue_health() from public, anon, authenticated;
grant execute on function public.tech_queue_health() to service_role;

-- =====================================================================
-- Verification
-- =====================================================================

-- a) Runs → one row with all six keys
select jsonb_object_keys(public.tech_queue_health()) as keys;

-- b) Grants → only service_role (plus postgres)
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'tech_queue_health';
