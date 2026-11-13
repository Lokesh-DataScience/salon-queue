-- step14_customer_app.sql — Customer app, Slice 1 (backend: app joins).
-- Run on the TESTS project first. Safe to run twice.
-- Production: run the whole file once, BEFORE deploying the matching backend code.
-- (The new join function has a default for p_source, so the old backend keeps working against it.)

begin;

-- 1) Where a ticket came from. Walk-ins keep their own is_walk_in flag; this is only qr / app.
alter table public.queue_entries
  add column if not exists join_source text not null default 'qr';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'queue_entries_join_source_chk') then
    alter table public.queue_entries
      add constraint queue_entries_join_source_chk check (join_source in ('qr', 'app'));
  end if;
end $$;

-- 2) Used by Slice 2 ("Not here" button). Added now so Slice 2 needs no schema change.
alter table public.queue_entries
  add column if not exists not_here_count integer not null default 0;

-- 3) Barber's switch in Settings: allow customers to take a token from the app (from home).
alter table public.salons
  add column if not exists allow_app_join boolean not null default true;

-- 4) join_queue: the lucky draw is for wall-QR scans only.
--    The source arrives through a transaction-local setting (set by join_queue_for_customer), so
--    join_queue keeps its signature and every other caller (walk-ins, tests, retries) is unchanged.
--    App joins: no draw, and they do not count towards the prize pacing.
CREATE OR REPLACE FUNCTION public.join_queue(p_salon_id uuid, p_client_key text DEFAULT NULL::text, p_lane_id uuid DEFAULT NULL::uuid)
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
  v_source text := coalesce(nullif(current_setting('app.join_source', true), ''), 'qr');
BEGIN
  IF v_source NOT IN ('qr', 'app') THEN v_source := 'qr'; END IF;

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

  INSERT INTO queue_entries (queue_id, token_number, status, joined_at, access_token, client_key, lane_id, join_source)
  VALUES (v_queue_id, v_next_token, 'WAITING', now(), v_access_token, p_client_key, v_lane_id, v_source)
  RETURNING id INTO v_entry_id;

  -- ── Reward draw: wall-QR scans only (never walk-ins, never app joins), under the queue lock ──
  IF v_source = 'qr'
     AND EXISTS (SELECT 1 FROM salon_offers o WHERE o.salon_id = p_salon_id AND o.active AND o.deleted_at IS NULL) THEN

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
            AND e.join_source = 'qr'
          GROUP BY q2.id
        ) t;
        v_expected := greatest(coalesce(v_expected, 15), 15);
        UPDATE queues q SET prize_expected = v_expected WHERE q.id = v_queue_id;
      END IF;
    END IF;

    SELECT count(*) INTO v_scans
    FROM queue_entries e
    WHERE e.queue_id = v_queue_id AND NOT coalesce(e.is_walk_in, false) AND e.join_source = 'qr';

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

-- 5) join_queue_for_customer gets p_source and an "already has a ticket" rule.
--    The return shape changes (new "existing" column), so the old function must be dropped first.
--    Dropping inside this transaction means there is no moment without a join function.
drop function if exists public.join_queue_for_customer(uuid, uuid[], text, uuid, text, text, boolean, text);
drop function if exists public.join_queue_for_customer(uuid, uuid[], text, uuid, text, text, boolean, text, text);

create function public.join_queue_for_customer(
  p_salon_id uuid,
  p_service_ids uuid[],
  p_client_key text,
  p_lane_id uuid,
  p_name text,
  p_phone text,
  p_consent boolean,
  p_remember_token text,
  p_source text default 'qr'
)
 returns table(entry_id uuid, queue_id uuid, token_number integer, access_token text, status text,
               joined_at timestamp with time zone, remember_token text, existing boolean)
 language plpgsql
as $function$
declare
  v_allow_app boolean;
  v_cust      record;
  v_row       record;
  v_old       record;
  v_key_hit   boolean := false;
begin
  if p_source is null or p_source not in ('qr', 'app') then
    raise exception 'INVALID_SOURCE';
  end if;

  -- Lock the salon first: the same order join_queue uses, so two joins can never deadlock,
  -- and two simultaneous joins by one customer are handled one after the other.
  select s.allow_app_join into v_allow_app
  from public.salons s where s.id = p_salon_id
  for update;
  if not found then raise exception 'SALON_NOT_FOUND'; end if;

  if p_source = 'app' and not v_allow_app then
    raise exception 'APP_JOIN_DISABLED';
  end if;

  -- A retried request (same client key) always gets its own ticket back from join_queue, as before.
  if p_client_key is not null then
    select true into v_key_hit
    from public.queue_entries e join public.queues q on q.id = e.queue_id
    where q.salon_id = p_salon_id and q.date = current_date and e.client_key = p_client_key
    limit 1;
    v_key_hit := coalesce(v_key_hit, false);
  end if;

  select r.* into v_cust
  from public.resolve_salon_customer(p_salon_id, p_name, p_phone, p_consent, p_remember_token) r;

  -- One active ticket per customer per salon.
  if not v_key_hit then
    select e.id, e.queue_id, e.token_number, e.access_token, e.status::text as status, e.joined_at
      into v_old
    from public.queue_entries e join public.queues q on q.id = e.queue_id
    where q.salon_id = p_salon_id
      and q.date = current_date
      and e.salon_customer_id = v_cust.customer_id
      and e.status in ('WAITING', 'CALLED', 'SERVING')
    order by e.joined_at desc
    limit 1;

    if found then
      -- remember_token is NULL when the customer was recognised by this device's remember token:
      -- that device already owns the ticket, so hand it back.
      if v_cust.remember_token is null then
        return query select v_old.id, v_old.queue_id, v_old.token_number, v_old.access_token,
                            v_old.status, v_old.joined_at, null::text, true;
        return;
      end if;
      -- Recognised only by name + phone (another device, or someone who knows the number):
      -- never hand out the ticket. Raising also rolls back the remember-token change above.
      raise exception 'ALREADY_IN_QUEUE';
    end if;
  end if;

  -- Tell join_queue where this join came from (decides the lucky draw). Local to this transaction only.
  perform set_config('app.join_source', p_source, true);

  select j.* into v_row
  from public.join_queue_with_services(p_salon_id, p_service_ids, p_client_key, p_lane_id) j;

  perform public.attach_customer_to_entry(v_row.entry_id, v_cust.customer_id);

  if not v_key_hit then
    update public.queue_entries e set join_source = p_source where e.id = v_row.entry_id;
  end if;

  return query select v_row.entry_id, v_row.queue_id, v_row.token_number,
                      v_row.access_token, v_row.status, v_row.joined_at, v_cust.remember_token, false;
end;
$function$;

revoke all on function public.join_queue_for_customer(uuid, uuid[], text, uuid, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.join_queue_for_customer(uuid, uuid[], text, uuid, text, text, boolean, text, text)
  to service_role;

-- 6) Self-check: if any part above is missing, stop here and undo everything.
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'queue_entries'
        and column_name in ('join_source', 'not_here_count')) <> 2 then
    raise exception 'step14 check failed: queue_entries columns missing. Run the WHOLE file with nothing selected.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'salons' and column_name = 'allow_app_join') then
    raise exception 'step14 check failed: salons.allow_app_join missing. Run the WHOLE file with nothing selected.';
  end if;
  if pg_get_functiondef('public.join_queue(uuid,text,uuid)'::regprocedure) not like '%app.join_source%' then
    raise exception 'step14 check failed: join_queue is the old version. Run the WHOLE file with nothing selected.';
  end if;
  if pg_get_functiondef('public.join_queue_for_customer(uuid,uuid[],text,uuid,text,text,boolean,text,text)'::regprocedure)
     not like '%set_config%' then
    raise exception 'step14 check failed: join_queue_for_customer is the old version. Run the WHOLE file with nothing selected.';
  end if;
  raise notice 'step14 OK';
end $$;

commit;

-- Check (should return 1 row, with 9 arguments):
-- select pg_get_function_identity_arguments(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'join_queue_for_customer';
