-- step6_offers.sql  (additive, idempotent)

create table if not exists public.salon_offers (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references public.salons (id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 40),
  daily_count  integer not null check (daily_count between 1 and 50),
  active       boolean not null default true,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists salon_offers_salon_idx on public.salon_offers (salon_id) where deleted_at is null;

create table if not exists public.offer_daily_stock (
  queue_id   uuid not null references public.queues (id) on delete cascade,
  offer_id   uuid not null references public.salon_offers (id) on delete cascade,
  remaining  integer not null check (remaining >= 0),
  constraint offer_daily_stock_pkey primary key (queue_id, offer_id)
);

alter table public.queues
  add column if not exists prize_expected integer;

alter table public.queue_entries
  add column if not exists offer_id uuid references public.salon_offers (id) on delete set null,
  add column if not exists prize_code text,
  add column if not exists prize_redeemed_at timestamptz;

create unique index if not exists queue_entries_prize_code_key
  on public.queue_entries (queue_id, prize_code) where prize_code is not null;

alter table public.salon_offers enable row level security;
alter table public.offer_daily_stock enable row level security;

-- join_queue: same signature and behaviour, plus the hidden prize draw at the end.
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
  -- prize draw
  v_expected int;
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

  -- ── Hidden prize draw (runs under the queue lock, so two joins can never take the same prize) ──
  IF EXISTS (SELECT 1 FROM salon_offers o WHERE o.salon_id = p_salon_id AND o.active AND o.deleted_at IS NULL) THEN

        -- the owner's own number wins; otherwise estimate from history (never below 15)
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
          GROUP BY q2.id
        ) t;
        v_expected := greatest(coalesce(v_expected, 15), 15);
        UPDATE queues q SET prize_expected = v_expected WHERE q.id = v_queue_id;
      END IF;
    END IF;

    -- today's stock for any active offer that has none yet (new offers start the same day)
    INSERT INTO offer_daily_stock (queue_id, offer_id, remaining)
    SELECT v_queue_id, o.id, o.daily_count
    FROM salon_offers o
    WHERE o.salon_id = p_salon_id AND o.active AND o.deleted_at IS NULL
    ON CONFLICT ON CONSTRAINT offer_daily_stock_pkey DO NOTHING;

    -- customers still to come, including this one (floored so the end of the day isn't a giveaway)
    v_left := greatest(v_expected - v_next_token + 1, 3);

    SELECT coalesce(sum(least(1.0, st.remaining::float8 / v_left)), 0) INTO v_total
    FROM offer_daily_stock st JOIN salon_offers o ON o.id = st.offer_id
    WHERE st.queue_id = v_queue_id AND st.remaining > 0 AND o.active AND o.deleted_at IS NULL;

    IF v_total > 0 THEN
      v_roll := random() * greatest(1.0, v_total);
      v_cum := 0;
      FOR v_rec IN
        SELECT st.offer_id AS oid, st.remaining AS rem
        FROM offer_daily_stock st JOIN salon_offers o ON o.id = st.offer_id
        WHERE st.queue_id = v_queue_id AND st.remaining > 0 AND o.active AND o.deleted_at IS NULL
        ORDER BY st.offer_id
      LOOP
        v_cum := v_cum + least(1.0, v_rec.rem::float8 / v_left);
        IF v_roll < v_cum THEN v_offer_id := v_rec.oid; EXIT; END IF;
      END LOOP;

      IF v_offer_id IS NOT NULL THEN
        UPDATE offer_daily_stock st SET remaining = st.remaining - 1
        WHERE st.queue_id = v_queue_id AND st.offer_id = v_offer_id AND st.remaining > 0;

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

  RETURN QUERY SELECT v_entry_id, v_queue_id, v_next_token, v_access_token, 'WAITING'::text, now();
END;
$function$;

REVOKE ALL ON FUNCTION public.join_queue(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(uuid) TO service_role;