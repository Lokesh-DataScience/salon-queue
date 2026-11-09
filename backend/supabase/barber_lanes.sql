-- step12_barber_lanes.sql  (Slice I: the barber side)
-- Run AFTER step11_customer_lanes.sql. Idempotent.
--
--   lanes.is_paused         a barber's break (pauses only their own line)
--   salon_is_multi_lane()   true when the salon has more than one active barber
--   lane_waits()            now also says which lines are on a break
--   set_lane_paused()       start / end a barber's break (locks the salon like join does)
--   join_queue()            refuses a barber on a break; "Any barber" never picks one
--   add_walk_in()           new optional p_lane_id: the walk-in joins that barber's line
--
-- A one-barber salon behaves exactly as before: its pause button still pauses the whole queue.

begin;

alter table public.lanes add column if not exists is_paused boolean not null default false;

-- Switching a barber back on never leaves their line stuck on an old break.
create or replace function public.lanes_reset_pause_on_activate()
returns trigger language plpgsql as $$
begin
  if new.is_active and not old.is_active then new.is_paused := false; end if;
  return new;
end;
$$;
drop trigger if exists lanes_reset_pause on public.lanes;
create trigger lanes_reset_pause before update of is_active on public.lanes
  for each row execute function public.lanes_reset_pause_on_activate();

create or replace function public.salon_is_multi_lane(p_salon_id uuid)
returns boolean language sql stable as $$
  select count(*) > 1 from lanes l where l.salon_id = p_salon_id and l.is_active
$$;

-- lane_waits gains a column, which needs a drop (join_queue only looks it up when it runs).
drop function if exists public.lane_waits(uuid);
create function public.lane_waits(p_salon_id uuid)
returns table (
  lane_id uuid, name text, is_default boolean, created_at timestamptz,
  waiting_count integer, wait_minutes integer, is_paused boolean
)
language sql
stable
as $$
  with cfg as (
    select coalesce(s.average_service_minutes, 15) as avg_min from salons s where s.id = p_salon_id
  ),
  today as (
    select q.id from queues q where q.salon_id = p_salon_id and q.date = current_date
  ),
  multi as (
    select salon_is_multi_lane(p_salon_id) as yes
  )
  select
    l.id, l.name, l.is_default, l.created_at,
    (count(e.id) filter (where e.status = 'WAITING'))::int,
    coalesce(sum(
      case
        when e.status = 'SERVING' and e.ends_at is not null
          then greatest(0, ceil(extract(epoch from (e.ends_at - clock_timestamp())) / 60))
        else coalesce(e.duration_minutes, (select avg_min from cfg))
      end
    ), 0)::int,
    (l.is_paused and (select yes from multi))
  from lanes l
  left join queue_entries e
    on e.lane_id = l.id
   and e.queue_id in (select id from today)
   and e.status in ('WAITING', 'CALLED', 'SERVING')
  where l.salon_id = p_salon_id and l.is_active
  group by l.id
$$;
revoke all on function public.lane_waits(uuid) from public, anon, authenticated;
grant execute on function public.lane_waits(uuid) to service_role;

create or replace function public.set_lane_paused(p_salon_id uuid, p_lane_id uuid, p_paused boolean)
returns void language plpgsql as $$
begin
  perform 1 from salons s where s.id = p_salon_id for update;   -- same lock join_queue takes
  update lanes l set is_paused = p_paused where l.id = p_lane_id and l.salon_id = p_salon_id;
  if not found then raise exception 'LANE_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.set_lane_paused(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_lane_paused(uuid, uuid, boolean) to service_role;

CREATE OR REPLACE FUNCTION public.join_queue(p_salon_id uuid, p_client_key text DEFAULT NULL, p_lane_id uuid DEFAULT NULL)
 RETURNS TABLE(entry_id uuid, queue_id uuid, token_number integer, access_token text, status text, joined_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_is_open boolean;
  v_is_queue_active boolean;
  v_opening text;
  v_closing text;
  v_queue_id uuid;
  v_next_token int;
  v_entry_id uuid;
  v_access_token text;
  v_expected int;
  v_scans int;
  v_left int;
  v_total float8;
  v_roll float8;
  v_cum float8;
  v_rec record;
  v_offer_id uuid;
  v_code text;
  v_lane_id uuid;
  v_lane_active boolean;
  v_lane_paused boolean;
BEGIN
  SELECT is_open, is_queue_active, opening_time, closing_time
    INTO v_is_open, v_is_queue_active, v_opening, v_closing
  FROM salons WHERE id = p_salon_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SALON_NOT_FOUND'; END IF;

  -- Same key again (double tap, retry, second tab): hand back the ticket that already exists.
  -- The salon row is locked above, so two simultaneous requests with one key cannot both pass this.
  IF p_client_key IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.queue_id, e.token_number, e.access_token, e.status::text, e.joined_at
      FROM queue_entries e JOIN queues q ON q.id = e.queue_id
      WHERE q.salon_id = p_salon_id AND q.date = CURRENT_DATE AND e.client_key = p_client_key
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF NOT v_is_open OR NOT is_within_hours(v_opening, v_closing) THEN RAISE EXCEPTION 'SALON_CLOSED'; END IF;
  IF NOT v_is_queue_active THEN RAISE EXCEPTION 'QUEUE_NOT_ACTIVE'; END IF;

  SELECT id INTO v_queue_id
  FROM queues WHERE salon_id = p_salon_id AND date = CURRENT_DATE
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO queues (salon_id, date, current_token, next_token, status)
    VALUES (p_salon_id, CURRENT_DATE, 0, 1, 'ACTIVE')
    RETURNING id INTO v_queue_id;
  END IF;

  IF EXISTS (SELECT 1 FROM queues q WHERE q.id = v_queue_id AND q.status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'QUEUE_NOT_ACTIVE';
  END IF;

  SELECT next_token INTO v_next_token FROM queues WHERE id = v_queue_id FOR UPDATE;
  UPDATE queues SET next_token = next_token + 1, updated_at = now() WHERE id = v_queue_id;

  -- ── Which barber's line? (the salon row is locked, so the lanes cannot change under us) ──
  IF p_lane_id IS NOT NULL THEN
    SELECT l.id, l.is_active, l.is_paused INTO v_lane_id, v_lane_active, v_lane_paused
    FROM lanes l WHERE l.id = p_lane_id AND l.salon_id = p_salon_id;   -- another salon's lane looks like no lane
    IF NOT FOUND THEN RAISE EXCEPTION 'LANE_NOT_FOUND'; END IF;
    IF NOT v_lane_active THEN RAISE EXCEPTION 'LANE_INACTIVE'; END IF;
    -- A barber's break only counts when there is more than one barber (a one-barber salon pauses the whole queue).
    IF v_lane_paused AND salon_is_multi_lane(p_salon_id) THEN RAISE EXCEPTION 'LANE_PAUSED'; END IF;
  ELSE
    -- "Any barber": the line with the shortest wait; ties go to the fewest waiting, then the owner's own line.
    SELECT w.lane_id INTO v_lane_id
    FROM lane_waits(p_salon_id) w
    WHERE NOT w.is_paused                       -- never a barber who is on a break
    ORDER BY w.wait_minutes, w.waiting_count, w.is_default DESC, w.created_at, w.lane_id
    LIMIT 1;
    IF v_lane_id IS NULL THEN
      -- every barber is on a break: nobody to join
      IF EXISTS (SELECT 1 FROM lane_waits(p_salon_id) w2 WHERE w2.is_paused) THEN
        RAISE EXCEPTION 'QUEUE_NOT_ACTIVE';
      END IF;
      SELECT l.id INTO v_lane_id FROM lanes l WHERE l.salon_id = p_salon_id AND l.is_default;
    END IF;
  END IF;

  v_access_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO queue_entries (queue_id, token_number, status, joined_at, access_token, client_key, lane_id)
  VALUES (v_queue_id, v_next_token, 'WAITING', now(), v_access_token, p_client_key, v_lane_id)
  RETURNING id INTO v_entry_id;

  -- ── Reward draw: QR scans only, under the queue lock ──
  IF EXISTS (SELECT 1 FROM salon_offers o WHERE o.salon_id = p_salon_id AND o.active AND o.deleted_at IS NULL) THEN

    SELECT s.expected_daily_customers INTO v_expected FROM salons s WHERE s.id = p_salon_id;
    IF v_expected IS NULL THEN
      SELECT q.prize_expected INTO v_expected FROM queues q WHERE q.id = v_queue_id;
      IF v_expected IS NULL THEN
        SELECT round(avg(t.c))::int INTO v_expected FROM (
          SELECT count(*) AS c
          FROM queue_entries e JOIN queues q2 ON q2.id = e.queue_id
          WHERE q2.salon_id = p_salon_id
            AND q2.date < CURRENT_DATE AND q2.date >= CURRENT_DATE - 7
            AND e.status <> 'CANCELLED'
            AND NOT coalesce(e.is_walk_in, false)
          GROUP BY q2.id
        ) t;
        v_expected := greatest(coalesce(v_expected, 15), 15);
        UPDATE queues q SET prize_expected = v_expected WHERE q.id = v_queue_id;
      END IF;
    END IF;

    SELECT count(*) INTO v_scans
    FROM queue_entries e
    WHERE e.queue_id = v_queue_id AND NOT coalesce(e.is_walk_in, false);

    -- Only the first `expected` QR customers are eligible.
    IF v_scans <= v_expected THEN
      v_left := v_expected - v_scans + 1;

      SELECT coalesce(sum(least(1.0, r.rem::float8 / v_left)), 0) INTO v_total
      FROM (
        SELECT greatest(0, o.daily_count - (
                 SELECT count(*) FROM queue_entries e WHERE e.queue_id = v_queue_id AND e.offer_id = o.id
               )) AS rem
        FROM salon_offers o
        WHERE o.salon_id = p_salon_id AND o.active AND o.deleted_at IS NULL
      ) r
      WHERE r.rem > 0;

      IF v_total > 0 THEN
        v_roll := random() * greatest(1.0, v_total);
        v_cum := 0;
        FOR v_rec IN
          SELECT r.oid, r.rem FROM (
            SELECT o.id AS oid,
                   greatest(0, o.daily_count - (
                     SELECT count(*) FROM queue_entries e WHERE e.queue_id = v_queue_id AND e.offer_id = o.id
                   )) AS rem
            FROM salon_offers o
            WHERE o.salon_id = p_salon_id AND o.active AND o.deleted_at IS NULL
          ) r
          WHERE r.rem > 0
          ORDER BY r.oid
        LOOP
          v_cum := v_cum + least(1.0, v_rec.rem::float8 / v_left);
          IF v_roll < v_cum THEN v_offer_id := v_rec.oid; EXIT; END IF;
        END LOOP;

        IF v_offer_id IS NOT NULL THEN
          LOOP
            v_code := (
              SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1), '')
              FROM generate_series(1, 6)
            );
            EXIT WHEN NOT EXISTS (
              SELECT 1 FROM queue_entries e WHERE e.queue_id = v_queue_id AND e.prize_code = v_code
            );
          END LOOP;

          UPDATE queue_entries e SET offer_id = v_offer_id, prize_code = v_code WHERE e.id = v_entry_id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT v_entry_id, v_queue_id, v_next_token, v_access_token, 'WAITING'::text, now();
END;
$function$;



REVOKE ALL ON FUNCTION public.join_queue(uuid, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(uuid, text, uuid) TO service_role;

drop function if exists public.add_walk_in(uuid);
create or replace function public.add_walk_in(p_salon_id uuid, p_lane_id uuid default null)
 returns table(entry_id uuid, token_number integer)
 language plpgsql
as $function$
declare
  v_is_open boolean;
  v_is_queue_active boolean;
  v_opening text;
  v_closing text;
  v_queue_id uuid;
  v_next_token int;
  v_entry_id uuid;
  v_lane_id uuid;
  v_lane_active boolean;
  v_lane_paused boolean;
begin
  select s.is_open, s.is_queue_active, s.opening_time, s.closing_time
    into v_is_open, v_is_queue_active, v_opening, v_closing
  from salons s where s.id = p_salon_id for update;

  if not found then raise exception 'SALON_NOT_FOUND'; end if;
  if not v_is_open or not is_within_hours(v_opening, v_closing) then raise exception 'SALON_CLOSED'; end if;
  if not v_is_queue_active then raise exception 'QUEUE_NOT_ACTIVE'; end if;

  select q.id into v_queue_id
  from queues q where q.salon_id = p_salon_id and q.date = current_date
  for update;

  if not found then
    insert into queues (salon_id, date, current_token, next_token, status)
    values (p_salon_id, current_date, 0, 1, 'ACTIVE')
    returning id into v_queue_id;
  end if;

  if exists (select 1 from queues q where q.id = v_queue_id and q.status <> 'ACTIVE') then
    raise exception 'QUEUE_NOT_ACTIVE';
  end if;

  -- Which barber's line? No lane given = the owner's own (default) line.
  if p_lane_id is null then
    select l.id into v_lane_id from lanes l where l.salon_id = p_salon_id and l.is_default;
  else
    select l.id, l.is_active, l.is_paused into v_lane_id, v_lane_active, v_lane_paused
    from lanes l where l.id = p_lane_id and l.salon_id = p_salon_id;
    if not found then raise exception 'LANE_NOT_FOUND'; end if;
    if not v_lane_active then raise exception 'LANE_INACTIVE'; end if;
    if v_lane_paused and salon_is_multi_lane(p_salon_id) then raise exception 'LANE_PAUSED'; end if;
  end if;

  select q.next_token into v_next_token from queues q where q.id = v_queue_id for update;
  update queues q set next_token = q.next_token + 1, updated_at = now() where q.id = v_queue_id;

  -- Same shape as a normal ticket, but flagged as a walk-in and with NO prize draw
  -- (a walk-in has no phone to reveal a prize on).
  insert into queue_entries (queue_id, token_number, status, joined_at, access_token, is_walk_in, lane_id)
  values (v_queue_id, v_next_token, 'WAITING', now(), encode(gen_random_bytes(32), 'hex'), true, v_lane_id)
  returning id into v_entry_id;

  return query select v_entry_id, v_next_token;
end;
$function$;


revoke all on function public.add_walk_in(uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_walk_in(uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';