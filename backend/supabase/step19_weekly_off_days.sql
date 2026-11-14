-- backend/supabase/step19_weekly_off_days.sql
-- Weekly off day, Slice 1.
-- Run on the TESTS project first. After the tests pass, run it on PRODUCTION, and only then deploy the backend
-- (the new backend reads salons.weekly_off_days, so the column must exist before the deploy).
-- Safe to run twice.

-- 1. The column. Day numbers: 0 = Sunday, 1 = Monday ... 6 = Saturday
--    (the same numbering as Postgres extract(dow) and JavaScript getDay()).
--    Empty = open every day, so every existing salon keeps working exactly as before.
alter table public.salons
  add column if not exists weekly_off_days smallint[] not null default '{}';

alter table public.salons drop constraint if exists salons_weekly_off_days_check;
alter table public.salons
  add constraint salons_weekly_off_days_check
  check (
    weekly_off_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and cardinality(weekly_off_days) <= 6          -- at least one day must stay open
  );

-- 2. Is today (India time) one of these days?
create or replace function public.is_off_day(p_days smallint[])
returns boolean
language sql
stable
as $$
  select extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint
         = any(coalesce(p_days, '{}'::smallint[]));
$$;

revoke all on function public.is_off_day(smallint[]) from public, anon, authenticated;
grant execute on function public.is_off_day(smallint[]) to service_role;

-- 3. Customer joins (wall QR and customer app) are refused on an off day.
--    The check sits here, not in join_queue, so the barber's +1 walk-in still works if he opens anyway.
--    Only change from the production version: v_off, the select of weekly_off_days, and the off-day check.
CREATE OR REPLACE FUNCTION public.join_queue_for_customer(p_salon_id uuid, p_service_ids uuid[], p_client_key text, p_lane_id uuid, p_name text, p_phone text, p_consent boolean, p_remember_token text, p_source text DEFAULT 'qr'::text)
 RETURNS TABLE(entry_id uuid, queue_id uuid, token_number integer, access_token text, status text, joined_at timestamp with time zone, remember_token text, existing boolean)
 LANGUAGE plpgsql
AS $function$
declare
  v_allow_app boolean;
  v_off       smallint[];
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
  select s.allow_app_join, s.weekly_off_days into v_allow_app, v_off
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

  -- Weekly off day (India time): no new customer tickets. Same answer as outside opening hours.
  if not v_key_hit and public.is_off_day(v_off) then
    raise exception 'SALON_CLOSED';
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

-- 4. Nearby search shows an off-day salon as closed. Only the is_open line changed.
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
    (s.is_open AND NOT is_off_day(s.weekly_off_days) AND is_within_hours(s.opening_time, s.closing_time)) AS is_open,
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
$function$;

-- 5. Checks (run after the script). Expected results in the comments.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'salons' and column_name = 'weekly_off_days';
-- 1 row: ARRAY, '{}'::smallint[], NO

select public.is_off_day(array[extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint]) as should_be_true,
       public.is_off_day('{}') as should_be_false;

select count(*) as should_be_2
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('join_queue_for_customer', 'nearby_salons')
  and p.prosrc ilike '%is_off_day%';

select grantee from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'is_off_day';
-- only postgres and service_role