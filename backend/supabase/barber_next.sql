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
  order by priority_at asc nulls last, token_number asc
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
