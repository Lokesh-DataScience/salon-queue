alter table queue_entries add column if not exists priority_at timestamptz;

create index if not exists queue_entries_waiting_order_idx
  on queue_entries (queue_id, priority_at nulls last, token_number)
  where status = 'WAITING';

-- Move a WAITING entry to the front. Earlier emergencies stay ahead of later ones.
create or replace function move_to_front(p_salon_id uuid, p_entry_id uuid)
returns int
language plpgsql
as $$
declare
  v_queue_id uuid;
  v_token int;
  v_status text;
  v_priority timestamptz;
  v_first uuid;
begin
  select e.queue_id, e.token_number into v_queue_id, v_token
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
  where e.queue_id = v_queue_id and e.status = 'WAITING'
  order by e.priority_at asc nulls last, e.token_number
  limit 1;
  if v_first = p_entry_id then raise exception 'ALREADY_NEXT'; end if;

  update queue_entries set priority_at = clock_timestamp() where id = p_entry_id;
  return v_token;
end;
$$;

revoke execute on function move_to_front(uuid, uuid) from public, anon, authenticated;