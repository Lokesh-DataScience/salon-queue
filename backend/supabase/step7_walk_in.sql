-- step7_walk_in.sql (additive, idempotent)
alter table public.queue_entries
  add column if not exists is_walk_in boolean not null default false;

create or replace function public.add_walk_in(p_salon_id uuid)
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

  select q.next_token into v_next_token from queues q where q.id = v_queue_id for update;
  update queues q set next_token = q.next_token + 1, updated_at = now() where q.id = v_queue_id;

  -- Same shape as a normal ticket, but flagged as a walk-in and with NO prize draw
  -- (a walk-in has no phone to reveal a prize on).
  insert into queue_entries (queue_id, token_number, status, joined_at, access_token, is_walk_in)
  values (v_queue_id, v_next_token, 'WAITING', now(), encode(gen_random_bytes(32), 'hex'), true)
  returning id into v_entry_id;

  return query select v_entry_id, v_next_token;
end;
$function$;

revoke all on function public.add_walk_in(uuid) from public, anon, authenticated;
grant execute on function public.add_walk_in(uuid) to service_role;