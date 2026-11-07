alter table queue_entries
  add column if not exists duration_minutes integer check (duration_minutes > 0),
  add column if not exists ends_at timestamptz;

create index if not exists queue_entries_serving_due_idx
  on queue_entries (ends_at) where status = 'SERVING';

-- Completes due entries and promotes the next WAITING one, chaining each start
-- from the previous ends_at. Safe to call any number of times, from anywhere.
create or replace function advance_queue(p_queue_id uuid)
returns table (completed_id uuid, started_id uuid)
language plpgsql
as $$
declare
  v_date date;
  v_salon_id uuid;
  v_avg int;
  v_now timestamptz := clock_timestamp();
  v_cursor timestamptz;
  v_s record;
  v_n record;
  v_dur int;
  v_guard int := 0;
begin
  select q.date, q.salon_id into v_date, v_salon_id
  from queues q where q.id = p_queue_id for update;
  if not found then return; end if;

  select s.average_service_minutes into v_avg from salons s where s.id = v_salon_id;
  v_avg := coalesce(v_avg, 15);

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 60;

    select e.id, e.ends_at, e.duration_minutes into v_s
    from queue_entries e
    where e.queue_id = p_queue_id and e.status = 'SERVING'
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

    -- nobody is being served
    exit when v_date <> current_date;  -- never start customers from an old day
    exit when exists (
      select 1 from queue_entries e where e.queue_id = p_queue_id and e.status = 'CALLED'
    );  -- old manual flow still in progress

    select e.id, e.token_number, e.duration_minutes into v_n
    from queue_entries e
    where e.queue_id = p_queue_id and e.status = 'WAITING'
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
end;
$$;

-- +minutes for the entry being served (ownership checked, queue locked).
create or replace function extend_entry(p_salon_id uuid, p_entry_id uuid, p_minutes int)
returns timestamptz
language plpgsql
as $$
declare
  v_queue_id uuid;
  v_ends timestamptz;
begin
  select e.queue_id into v_queue_id
  from queue_entries e join queues q on q.id = e.queue_id
  where e.id = p_entry_id and q.salon_id = p_salon_id;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;

  perform 1 from queues q where q.id = v_queue_id for update;

  update queue_entries e
  set ends_at = greatest(coalesce(e.ends_at, clock_timestamp()), clock_timestamp())
                + make_interval(mins => p_minutes)
  where e.id = p_entry_id and e.status = 'SERVING'
  returning e.ends_at into v_ends;

  if v_ends is null then raise exception 'NOT_SERVING'; end if;
  return v_ends;
end;
$$;

-- These must only be callable by the backend, never by the public anon key.
revoke execute on function advance_queue(uuid) from public, anon, authenticated;
revoke execute on function extend_entry(uuid, uuid, int) from public, anon, authenticated;

notify pgrst, 'reload schema';