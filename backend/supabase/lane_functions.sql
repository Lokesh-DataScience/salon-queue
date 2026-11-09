-- step9b_lane_functions.sql  (Slice F, part 2 of 2: lane-aware queue functions)
-- Run AFTER step9_lanes.sql. With one lane per salon these behave exactly as before.
--
--   advance_queue(queue_id)        one SERVING customer PER LANE (was: one per queue)
--   barber_next(salon_id, lane_id) lane_id optional; omitted = the salon's default lane
--   move_to_front(salon, entry)    "already next" is judged inside the entry's own lane
--
-- Not touched on purpose: join_queue, join_queue_with_services, add_walk_in (the trigger
-- from part 1 puts their entries in the default lane; Slice H adds the lane choice).

begin;

-- ── advance_queue ───────────────────────────────────────────────────────────
create or replace function public.advance_queue(p_queue_id uuid)
returns table (completed_id uuid, started_id uuid)
language plpgsql
as $$
declare
  v_date date;
  v_salon_id uuid;
  v_avg int;
  v_now timestamptz := clock_timestamp();
  v_cursor timestamptz;
  v_l record;
  v_s record;
  v_n record;
  v_dur int;
  v_guard int;
begin
  select q.date, q.salon_id into v_date, v_salon_id
  from queues q where q.id = p_queue_id for update;
  if not found then return; end if;

  select s.average_service_minutes into v_avg from salons s where s.id = v_salon_id;
  v_avg := coalesce(v_avg, 15);

  -- Each lane is its own little queue: at most one SERVING customer per lane.
  for v_l in
    select l.id, l.is_active
    from lanes l
    where l.salon_id = v_salon_id
    order by l.is_default desc, l.created_at, l.id
  loop
    v_guard := 0;
    v_cursor := null;

    loop
      v_guard := v_guard + 1;
      exit when v_guard > 60;

      select e.id, e.ends_at, e.duration_minutes into v_s
      from queue_entries e
      where e.queue_id = p_queue_id and e.lane_id = v_l.id and e.status = 'SERVING'
      order by e.token_number
      limit 1
      for update;

      if found then
        if v_s.ends_at is null then
          -- started by the old manual flow: give it a countdown from now
          update queue_entries
          set ends_at = v_now + make_interval(mins => coalesce(v_s.duration_minutes, v_avg))
          where id = v_s.id;
          exit;
        end if;

        exit when v_s.ends_at > v_now;

        update queue_entries
        set status = 'COMPLETED', completed_at = v_s.ends_at
        where id = v_s.id;

        completed_id := v_s.id; started_id := null;
        return next;
        v_cursor := v_s.ends_at;
        continue;
      end if;

      -- nobody is being served in this lane
      exit when v_date <> current_date;      -- never start customers from an old day
      exit when not v_l.is_active;           -- a switched-off lane starts no one new
      exit when exists (
        select 1 from queue_entries e
        where e.queue_id = p_queue_id and e.lane_id = v_l.id and e.status = 'CALLED'
      );                                     -- old manual flow still in progress

      select e.id, e.token_number, e.duration_minutes into v_n
      from queue_entries e
      where e.queue_id = p_queue_id and e.lane_id = v_l.id and e.status = 'WAITING'
      order by e.priority_at asc nulls last, e.token_number
      limit 1
      for update;
      exit when not found;

      v_dur := coalesce(v_n.duration_minutes, v_avg);

      update queue_entries
      set status = 'SERVING',
          started_at = coalesce(v_cursor, v_now),
          ends_at = coalesce(v_cursor, v_now) + make_interval(mins => v_dur)
      where id = v_n.id;

      update queues set current_token = v_n.token_number, updated_at = now()
      where id = p_queue_id;

      completed_id := null; started_id := v_n.id;
      return next;
      v_cursor := null;
    end loop;
  end loop;
end;
$$;

-- ── barber_next ─────────────────────────────────────────────────────────────
-- A new optional argument changes the signature, and two overloads would confuse
-- PostgREST (same issue step8 hit with join_queue), so the old one is dropped first.
drop function if exists public.barber_next(uuid);

create or replace function public.barber_next(p_salon_id uuid, p_lane_id uuid default null)
returns table(completed_entry_id uuid, called_entry_id uuid, called_token_number integer)
language plpgsql
as $$
declare
  v_queue_id uuid;
  v_lane uuid;
  v_serving_id uuid;
  v_already_called_id uuid;
  v_completed_id uuid;
  v_called_id uuid;
  v_called_token int;
begin
  -- Lane must belong to this salon; no lane given = the salon's default lane.
  select l.id into v_lane
  from lanes l
  where l.salon_id = p_salon_id
    and ((p_lane_id is not null and l.id = p_lane_id) or (p_lane_id is null and l.is_default));
  if v_lane is null then
    raise exception 'LANE_NOT_FOUND';
  end if;

  select q.id into v_queue_id
  from queues q
  where q.salon_id = p_salon_id and q.date = current_date
  for update;

  if v_queue_id is null then
    raise exception 'NO_ACTIVE_QUEUE';
  end if;

  -- Refuse to call a new customer while one is already CALLED in this lane.
  select e.id into v_already_called_id
  from queue_entries e
  where e.queue_id = v_queue_id and e.lane_id = v_lane and e.status = 'CALLED'
  for update;

  if v_already_called_id is not null then
    raise exception 'ALREADY_CALLED';
  end if;

  -- Complete whoever this lane is currently serving, if anyone.
  select e.id into v_serving_id
  from queue_entries e
  where e.queue_id = v_queue_id and e.lane_id = v_lane and e.status = 'SERVING'
  for update;

  if v_serving_id is not null then
    update queue_entries
    set status = 'COMPLETED', completed_at = now()
    where id = v_serving_id;
    v_completed_id := v_serving_id;
  end if;

  -- Call the next waiting entry in this lane (does NOT start service yet).
  select e.id, e.token_number into v_called_id, v_called_token
  from queue_entries e
  where e.queue_id = v_queue_id and e.lane_id = v_lane and e.status = 'WAITING'
  order by e.priority_at asc nulls last, e.token_number asc
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
$$;

revoke all on function public.barber_next(uuid, uuid) from public, anon, authenticated;
grant execute on function public.barber_next(uuid, uuid) to service_role;

-- ── move_to_front ───────────────────────────────────────────────────────────
-- Same as before, except "is this customer already next?" looks only at their own lane.
create or replace function public.move_to_front(p_salon_id uuid, p_entry_id uuid)
returns int
language plpgsql
as $$
declare
  v_queue_id uuid;
  v_lane uuid;
  v_token int;
  v_status text;
  v_priority timestamptz;
  v_first uuid;
begin
  select e.queue_id, e.token_number, e.lane_id into v_queue_id, v_token, v_lane
  from queue_entries e join queues q on q.id = e.queue_id
  where e.id = p_entry_id and q.salon_id = p_salon_id and q.date = current_date;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;

  -- Same lock advance_queue takes, so the sweeper and a bump cannot interleave.
  perform 1 from queues q where q.id = v_queue_id for update;

  select e.status::text, e.priority_at into v_status, v_priority
  from queue_entries e where e.id = p_entry_id;

  if v_status <> 'WAITING' then raise exception 'NOT_WAITING'; end if;
  if v_priority is not null then raise exception 'ALREADY_PRIORITY'; end if;

  select e.id into v_first
  from queue_entries e
  where e.queue_id = v_queue_id and e.lane_id = v_lane and e.status = 'WAITING'
  order by e.priority_at asc nulls last, e.token_number
  limit 1;
  if v_first = p_entry_id then raise exception 'ALREADY_NEXT'; end if;

  update queue_entries set priority_at = clock_timestamp() where id = p_entry_id;
  return v_token;
end;
$$;

commit;

notify pgrst, 'reload schema';