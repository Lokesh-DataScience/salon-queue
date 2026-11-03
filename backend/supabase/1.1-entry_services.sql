begin;

-- What each customer chose. The name is copied at join time, so renaming or
-- removing a service later never changes what an old ticket shows.
create table if not exists public.queue_entry_services (
  entry_id     uuid not null references public.queue_entries(id) on delete cascade,
  service_id   uuid not null references public.salon_services(id),
  service_name text not null,
  primary key (entry_id, service_id)
);

alter table public.queue_entry_services enable row level security;
revoke all on public.queue_entry_services from anon, authenticated;
grant all on public.queue_entry_services to service_role;

-- One join_queue only: drop the old signature so PostgREST has nothing ambiguous to choose from.
drop function if exists public.join_queue(uuid, text);

CREATE OR REPLACE FUNCTION public.join_queue(
  p_salon_id uuid,
  p_client_key text DEFAULT NULL,
  p_service_ids uuid[] DEFAULT NULL
)
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

  v_access_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO queue_entries (queue_id, token_number, status, joined_at, access_token, client_key)
  VALUES (v_queue_id, v_next_token, 'WAITING', now(), v_access_token, p_client_key)
  RETURNING id INTO v_entry_id;

  -- ── Chosen services: same transaction as the ticket. Only this salon's active services are
  --    accepted; any other id is silently ignored, so another salon's service can never attach. ──
  IF p_service_ids IS NOT NULL AND cardinality(p_service_ids) > 0 THEN
    INSERT INTO queue_entry_services (entry_id, service_id, service_name)
    SELECT v_entry_id, sv.id, sv.name
    FROM salon_services sv
    WHERE sv.salon_id = p_salon_id
      AND sv.deleted_at IS NULL
      AND sv.id = ANY(p_service_ids);
  END IF;

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

REVOKE ALL ON FUNCTION public.join_queue(uuid, text, uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(uuid, text, uuid[]) TO service_role;

commit;