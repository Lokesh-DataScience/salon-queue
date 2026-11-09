-- step13_lane_moves.sql  (Slice J: removing a barber no longer strands their customers)
-- Run AFTER step12_barber_lanes.sql. Idempotent.
--
-- set_staff_active(...) now RETURNS the number of customers moved.
--   Switching a barber OFF:
--     * a customer already CALLED or SERVING with them blocks it (LANE_BUSY): they finish first.
--     * every WAITING customer moves to the shortest line among the remaining barbers who are not
--       on a break (the owner's line if everyone else is on one). Token numbers do not change, and
--       a customer who was moved up keeps that priority.
--     * all of it is one transaction under the salon lock that join_queue / add_walk_in also take,
--       so nobody can join the line while it is being emptied.
--   Switching a barber ON is unchanged.

begin;

drop function if exists public.set_staff_active(uuid, uuid, boolean);

create function public.set_staff_active(p_salon_id uuid, p_staff_id uuid, p_active boolean)
returns integer
language plpgsql
as $$
declare
  v_lane uuid;
  v_count int;
  v_moved int := 0;
  v_entry record;
  v_target uuid;
begin
  perform 1 from salons s where s.id = p_salon_id for update;

  -- The owner can never be switched off, and nobody can touch another salon's staff.
  select st.lane_id into v_lane
  from salon_staff st
  where st.id = p_staff_id and st.salon_id = p_salon_id and st.role <> 'OWNER';
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;

  if p_active then
    select count(*) into v_count from lanes l
    where l.salon_id = p_salon_id and l.is_active and l.id <> v_lane;
    if v_count >= 10 then raise exception 'TOO_MANY_BARBERS'; end if;

    update salon_staff set is_active = true where id = p_staff_id;
    update lanes set is_active = true where id = v_lane;
    return 0;
  end if;

  -- Someone is at the chair (or has been called): let them finish with this barber first.
  if exists (
    select 1 from queue_entries e join queues q on q.id = e.queue_id
    where e.lane_id = v_lane and q.date = current_date and e.status in ('CALLED', 'SERVING')
  ) then
    raise exception 'LANE_BUSY';
  end if;

  -- Switch the line off first: lane_waits() only lists active lines, so it can never pick this one.
  update salon_staff set is_active = false where id = p_staff_id;
  update lanes set is_active = false where id = v_lane;

  for v_entry in
    select e.id
    from queue_entries e join queues q on q.id = e.queue_id
    where e.lane_id = v_lane and q.date = current_date and e.status = 'WAITING'
    order by e.priority_at asc nulls last, e.token_number asc
  loop
    select w.lane_id into v_target
    from lane_waits(p_salon_id) w
    where not w.is_paused
    order by w.wait_minutes, w.waiting_count, w.is_default desc, w.created_at, w.lane_id
    limit 1;

    if v_target is null then   -- everyone else is on a break: the owner's line
      select l.id into v_target from lanes l
      where l.salon_id = p_salon_id and l.is_default and l.is_active;
    end if;

    update queue_entries set lane_id = v_target where id = v_entry.id;
    v_moved := v_moved + 1;
  end loop;

  return v_moved;
end;
$$;

revoke all on function public.set_staff_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_staff_active(uuid, uuid, boolean) to service_role;

commit;

notify pgrst, 'reload schema';
