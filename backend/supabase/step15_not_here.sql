-- step15_not_here.sql — Customer app, Slice 2: the barber's "Not here" button.
-- Needs step14 first. Run on the TESTS project first, with NOTHING highlighted in the editor.
-- Safe to run twice. Ends with "step15 OK".
--
-- Serve order everywhere is now:  called/serving  ->  emergency bumps (priority_at)
--   ->  coalesce(order_key, token_number)  ->  token_number.
-- order_key is empty for every normal ticket, so nothing changes until someone is moved back.

begin;

alter table public.queue_entries add column if not exists order_key numeric;

-- advance_queue / barber_next / move_to_front: unchanged except the ORDER BY that picks the next customer.
CREATE OR REPLACE FUNCTION public.advance_queue(p_queue_id uuid)
 RETURNS TABLE(completed_id uuid, started_id uuid)
 LANGUAGE plpgsql
AS $function$
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
      order by e.priority_at asc nulls last, coalesce(e.order_key, e.token_number::numeric), e.token_number
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
$function$;

CREATE OR REPLACE FUNCTION public.barber_next(p_salon_id uuid, p_lane_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(completed_entry_id uuid, called_entry_id uuid, called_token_number integer)
 LANGUAGE plpgsql
AS $function$
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
  order by e.priority_at asc nulls last, coalesce(e.order_key, e.token_number::numeric), e.token_number
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
$function$;

CREATE OR REPLACE FUNCTION public.move_to_front(p_salon_id uuid, p_entry_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
  order by e.priority_at asc nulls last, coalesce(e.order_key, e.token_number::numeric), e.token_number
  limit 1;
  if v_first = p_entry_id then raise exception 'ALREADY_NEXT'; end if;

  update queue_entries set priority_at = clock_timestamp() where id = p_entry_id;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_not_here(p_salon_id uuid, p_entry_id uuid)
 RETURNS TABLE(action text, token_number integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_queue_id uuid;
  v_e record;
  v_target record;
  v_after record;
  v_tk numeric;
  v_nk numeric;
  v_others int;
begin
  select e.queue_id into v_queue_id
  from queue_entries e join queues q on q.id = e.queue_id
  where e.id = p_entry_id and q.salon_id = p_salon_id and q.date = current_date;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;

  -- Same lock advance_queue and move_to_front take: the sweeper and this cannot interleave,
  -- and a double tap is handled one after the other (the second finds the customer no longer at the chair).
  perform 1 from queues q where q.id = v_queue_id for update;

  select e.id, e.status::text as status, e.token_number, e.lane_id, e.join_source, e.not_here_count
    into v_e
  from queue_entries e where e.id = p_entry_id
  for update;

  if v_e.join_source <> 'app' then raise exception 'NOT_APP_JOIN'; end if;
  if v_e.status not in ('CALLED', 'SERVING') then raise exception 'NOT_AT_CHAIR'; end if;

  select count(*) into v_others
  from queue_entries e
  where e.queue_id = v_queue_id and e.lane_id = v_e.lane_id and e.status = 'WAITING';

  -- Second time not here, or nobody else to serve in the meantime: cancel the ticket.
  if v_e.not_here_count >= 1 or v_others = 0 then
    update queue_entries e
    set status = 'CANCELLED', cancelled_at = now(), not_here_count = e.not_here_count + 1
    where e.id = p_entry_id;
    return query select 'cancelled'::text, v_e.token_number;
    return;
  end if;

  -- Move back behind the next two waiting customers of this barber's line (behind one if only one waits).
  select e.id, e.priority_at, coalesce(e.order_key, e.token_number::numeric) as k into v_target
  from queue_entries e
  where e.queue_id = v_queue_id and e.lane_id = v_e.lane_id and e.status = 'WAITING'
  order by e.priority_at asc nulls last, coalesce(e.order_key, e.token_number::numeric), e.token_number
  offset least(v_others, 2) - 1
  limit 1;

  if v_target.priority_at is not null then
    -- The person we go behind was an emergency bump: sit right after them among the bumps.
    update queue_entries e
    set priority_at = v_target.priority_at + interval '1 microsecond', order_key = null
    where e.id = p_entry_id;
  else
    v_tk := v_target.k;
    select coalesce(e.order_key, e.token_number::numeric) as k into v_after
    from queue_entries e
    where e.queue_id = v_queue_id and e.lane_id = v_e.lane_id and e.status = 'WAITING'
      and e.priority_at is null
      and coalesce(e.order_key, e.token_number::numeric) > v_tk
    order by coalesce(e.order_key, e.token_number::numeric), e.token_number
    limit 1;
    v_nk := coalesce(v_after.k, v_tk + 1);
    update queue_entries e
    set priority_at = null, order_key = (v_tk + v_nk) / 2
    where e.id = p_entry_id;
  end if;

  update queue_entries e
  set status = 'WAITING', called_at = null, started_at = null, ends_at = null,
      notified_stage = 0, not_here_count = e.not_here_count + 1
  where e.id = p_entry_id;

  return query select 'moved_back'::text, v_e.token_number;
end;
$function$;

revoke all on function public.mark_not_here(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_not_here(uuid, uuid) to service_role;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'queue_entries' and column_name = 'order_key') then
    raise exception 'step15 check failed: queue_entries.order_key missing. Run the WHOLE file with nothing selected.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'queue_entries' and column_name = 'join_source') then
    raise exception 'step15 check failed: run step14_customer_app.sql first.';
  end if;
  if pg_get_functiondef('public.advance_queue(uuid)'::regprocedure) not like '%order_key%'
     or pg_get_functiondef('public.barber_next(uuid,uuid)'::regprocedure) not like '%order_key%'
     or pg_get_functiondef('public.move_to_front(uuid,uuid)'::regprocedure) not like '%order_key%' then
    raise exception 'step15 check failed: a queue function is still the old version. Run the WHOLE file with nothing selected.';
  end if;
  perform 'public.mark_not_here(uuid,uuid)'::regprocedure;
  raise notice 'step15 OK';
end $$;

commit;
