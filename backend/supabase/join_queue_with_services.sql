CREATE OR REPLACE FUNCTION public.join_queue_with_services(p_salon_id uuid, p_service_ids uuid[], p_client_key text DEFAULT NULL::text)
 RETURNS TABLE(entry_id uuid, queue_id uuid, token_number integer, access_token text, status text, joined_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
declare
  v_ids uuid[];
  v_found int;
  v_total int := 0;
  v_row record;
begin
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
  from unnest(coalesce(p_service_ids, '{}'::uuid[])) as x;

  if cardinality(v_ids) > 8 then raise exception 'INVALID_SERVICES'; end if;

  if cardinality(v_ids) > 0 then
    select count(*), coalesce(sum(s.duration_minutes), 0) into v_found, v_total
    from salon_services s
    where s.salon_id = p_salon_id and s.deleted_at is null and s.id = any(v_ids);
    if v_found <> cardinality(v_ids) then raise exception 'INVALID_SERVICES'; end if;
  end if;

  select j.* into v_row
  from join_queue(p_salon_id => p_salon_id, p_client_key => p_client_key) j;

  -- Only a brand-new ticket gets services. A retried key returns the existing ticket untouched.
  if cardinality(v_ids) > 0
     and exists (select 1 from queue_entries e
                 where e.id = v_row.entry_id and e.status = 'WAITING' and e.duration_minutes is null)
     and not exists (select 1 from queue_entry_services qs where qs.queue_entry_id = v_row.entry_id)
  then
    insert into queue_entry_services (queue_entry_id, service_id, name, duration_minutes)
    select v_row.entry_id, s.id, s.name, s.duration_minutes
    from salon_services s where s.id = any(v_ids);

    update queue_entries e set duration_minutes = v_total where e.id = v_row.entry_id;
  end if;

  return query select v_row.entry_id, v_row.queue_id, v_row.token_number,
                      v_row.access_token, v_row.status, v_row.joined_at;
end;
$function$
