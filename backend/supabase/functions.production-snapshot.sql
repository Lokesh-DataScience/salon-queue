CREATE OR REPLACE FUNCTION public.barber_next(p_salon_id uuid)
 RETURNS TABLE(completed_entry_id uuid, called_entry_id uuid, called_token_number integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_queue_id uuid;
  v_serving_id uuid;
  v_already_called_id uuid;
  v_completed_id uuid;
  v_called_id uuid;
  v_called_token int;
begin
  select id into v_queue_id
  from queues
  where salon_id = p_salon_id and date = current_date
  for update;

  if v_queue_id is null then
    raise exception 'NO_ACTIVE_QUEUE';
  end if;

  -- Refuse to call a new customer while one is already CALLED and
  -- hasn't been started, completed, or skipped yet.
  select id into v_already_called_id
  from queue_entries
  where queue_id = v_queue_id and status = 'CALLED'
  for update;

  if v_already_called_id is not null then
    raise exception 'ALREADY_CALLED';
  end if;

  -- Complete whoever is currently being served, if anyone.
  select id into v_serving_id
  from queue_entries
  where queue_id = v_queue_id and status = 'SERVING'
  for update;

  if v_serving_id is not null then
    update queue_entries
    set status = 'COMPLETED', completed_at = now()
    where id = v_serving_id;
    v_completed_id := v_serving_id;
  end if;

  -- Call the next waiting entry (does NOT start service yet).
  select id, token_number into v_called_id, v_called_token
  from queue_entries
  where queue_id = v_queue_id and status = 'WAITING'
  order by token_number asc
  for update
  limit 1;

  if v_called_id is not null then
    update queue_entries
    set status = 'CALLED', called_at = now()
    where id = v_called_id;

    update queues
    set current_token = v_called_token
    where id = v_queue_id;
  end if;

  return query select v_completed_id, v_called_id, v_called_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_customer_data(p_retention_hours integer)
 RETURNS TABLE(cancelled_stale integer, anonymized integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_cancelled int;
  v_anon int;
begin
  -- 1. Entries stuck active on a past day's queue become CANCELLED.
  update queue_entries e
  set status = 'CANCELLED', cancelled_at = now()
  from queues q
  where e.queue_id = q.id
    and q.date < current_date
    and e.status in ('WAITING', 'CALLED', 'SERVING');
  get diagnostics v_cancelled = row_count;

  -- 2. Push subscriptions are useless once a ticket is finished, and the endpoint
  --    is an identifier, so drop them immediately (no retention window).
  update queue_entries
  set push_subscription = null
  where status in ('COMPLETED', 'SKIPPED', 'CANCELLED')
    and push_subscription is not null;

  -- 3. Null out personal data on finished entries past the window.
  update queue_entries
  set customer_name = null, customer_phone = null
  where status in ('COMPLETED', 'SKIPPED', 'CANCELLED')
    and (customer_name is not null or customer_phone is not null)
    and coalesce(completed_at, skipped_at, cancelled_at)
        < now() - make_interval(hours => p_retention_hours);
  get diagnostics v_anon = row_count;

  return query select v_cancelled, v_anon;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_within_hours(p_opening text, p_closing text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when p_opening::time >= p_closing::time then true
    else date_trunc('minute', now() at time zone 'Asia/Kolkata')::time
         between p_opening::time and p_closing::time
  end;
$function$
;

-- CREATE OR REPLACE FUNCTION public.join_queue(p_salon_id uuid, p_customer_name text, p_customer_phone text)
--  RETURNS TABLE(entry_id uuid, queue_id uuid, token_number integer, access_token text, status text, joined_at timestamp with time zone)
--  LANGUAGE plpgsql
-- AS $function$
-- DECLARE
--   v_is_open boolean;
--   v_is_queue_active boolean;
--   v_opening text;
--   v_closing text;
--   v_queue_id uuid;
--   v_next_token int;
--   v_entry_id uuid;
--   v_access_token text;
-- BEGIN
--   SELECT is_open, is_queue_active, opening_time, closing_time
--     INTO v_is_open, v_is_queue_active, v_opening, v_closing
--   FROM salons WHERE id = p_salon_id FOR UPDATE;

--   IF NOT FOUND THEN RAISE EXCEPTION 'SALON_NOT_FOUND'; END IF;
--   IF NOT v_is_open OR NOT is_within_hours(v_opening, v_closing) THEN RAISE EXCEPTION 'SALON_CLOSED'; END IF;
--   IF NOT v_is_queue_active THEN RAISE EXCEPTION 'QUEUE_NOT_ACTIVE'; END IF;

--   SELECT id INTO v_queue_id
--   FROM queues WHERE salon_id = p_salon_id AND date = CURRENT_DATE
--   FOR UPDATE;

--   IF NOT FOUND THEN
--     INSERT INTO queues (salon_id, date, current_token, next_token, status)
--     VALUES (p_salon_id, CURRENT_DATE, 0, 1, 'ACTIVE')
--     RETURNING id INTO v_queue_id;
--   END IF;

--   -- a paused or closed queue refuses new joins
--   IF EXISTS (SELECT 1 FROM queues q WHERE q.id = v_queue_id AND q.status <> 'ACTIVE') THEN
--     RAISE EXCEPTION 'QUEUE_NOT_ACTIVE';
--   END IF;

--   SELECT next_token INTO v_next_token FROM queues WHERE id = v_queue_id FOR UPDATE;

--   UPDATE queues SET next_token = next_token + 1, updated_at = now() WHERE id = v_queue_id;

--   v_access_token := encode(gen_random_bytes(32), 'hex');

--   INSERT INTO queue_entries (
--     queue_id, token_number, customer_name, customer_phone,
--     status, joined_at, access_token
--   ) VALUES (
--     v_queue_id, v_next_token, p_customer_name, p_customer_phone,
--     'WAITING', now(), v_access_token
--   )
--   RETURNING id INTO v_entry_id;

--   RETURN QUERY SELECT v_entry_id, v_queue_id, v_next_token, v_access_token, 'WAITING'::text, now();
-- END;
-- $function$
-- ;

-- 1) Customer details become optional (no data is deleted).
ALTER TABLE public.queue_entries ALTER COLUMN customer_name  DROP NOT NULL;
ALTER TABLE public.queue_entries ALTER COLUMN customer_phone DROP NOT NULL;

-- 2) New anonymous join. Same logic as before, no name or phone.
CREATE OR REPLACE FUNCTION public.join_queue(p_salon_id uuid)
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
BEGIN
  SELECT is_open, is_queue_active, opening_time, closing_time
    INTO v_is_open, v_is_queue_active, v_opening, v_closing
  FROM salons WHERE id = p_salon_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SALON_NOT_FOUND'; END IF;
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

  INSERT INTO queue_entries (queue_id, token_number, status, joined_at, access_token)
  VALUES (v_queue_id, v_next_token, 'WAITING', now(), v_access_token)
  RETURNING id INTO v_entry_id;

  RETURN QUERY SELECT v_entry_id, v_queue_id, v_next_token, v_access_token, 'WAITING'::text, now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.nearby_salons(p_lat double precision, p_lng double precision, p_radius_km double precision DEFAULT 5)
 RETURNS TABLE(id uuid, name text, description text, phone text, address text, latitude double precision, longitude double precision, opening_time text, closing_time text, average_service_minutes integer, is_open boolean, is_queue_active boolean, distance_km double precision, queue_size bigint, current_token integer, estimated_wait_minutes integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.name, s.description, s.phone, s.address,
    s.latitude, s.longitude, s.opening_time, s.closing_time,
    s.average_service_minutes,
    (s.is_open AND is_within_hours(s.opening_time, s.closing_time)) AS is_open,
    s.is_queue_active,
    (6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(p_lat)) * cos(radians(s.latitude)) *
      cos(radians(s.longitude) - radians(p_lng)) +
      sin(radians(p_lat)) * sin(radians(s.latitude))
    )))) AS distance_km,
    COALESCE(qe.waiting_count, 0) AS queue_size,
    COALESCE(q.current_token, 0) AS current_token,
    (COALESCE(qe.waiting_count, 0) * s.average_service_minutes)::int AS estimated_wait_minutes
  FROM salons s
  LEFT JOIN queues q ON q.salon_id = s.id AND q.date = CURRENT_DATE
  LEFT JOIN (
    SELECT queue_id, COUNT(*) AS waiting_count
    FROM queue_entries
    WHERE status = 'WAITING'
    GROUP BY queue_id
  ) qe ON qe.queue_id = q.id
  WHERE (6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(p_lat)) * cos(radians(s.latitude)) *
      cos(radians(s.longitude) - radians(p_lng)) +
      sin(radians(p_lat)) * sin(radians(s.latitude))
    )))) <= p_radius_km
  ORDER BY distance_km ASC;
END;
$function$
;

-- Permissions: only the backend (service role) may run these.
revoke all on function is_within_hours(text, text) from public, anon, authenticated;
grant execute on function is_within_hours(text, text) to service_role;
-- revoke all on function join_queue(uuid, text, text) from public, anon, authenticated;
-- grant execute on function join_queue(uuid, text, text) to service_role;
REVOKE ALL ON FUNCTION public.join_queue(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(uuid) TO service_role;
revoke all on function barber_next(uuid) from public, anon, authenticated;
grant execute on function barber_next(uuid) to service_role;
revoke all on function nearby_salons(double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function nearby_salons(double precision, double precision, double precision) to service_role;
revoke all on function cleanup_customer_data(integer) from public, anon, authenticated;
grant execute on function cleanup_customer_data(integer) to service_role;