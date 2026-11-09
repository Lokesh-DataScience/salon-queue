-- step10_team.sql  (Slice G: team management)
-- Run AFTER step9_lanes.sql and step9b_lane_functions.sql. Additive + idempotent.
--
--   add_staff_with_lane   creates a barber AND their lane in one transaction
--   set_staff_active      switches a barber (and their lane) off or on
--
-- Both lock the salon row first: join_queue / add_walk_in lock the same row, so a barber
-- cannot be switched off in the middle of a customer joining their lane.

begin;

alter table public.salon_staff add column if not exists is_active boolean not null default true;

create or replace function public.add_staff_with_lane(
  p_salon_id uuid, p_name text, p_phone text, p_password_hash text
)
returns table(o_staff_id uuid, o_lane_id uuid)
language plpgsql
as $$
declare
  v_lane uuid;
  v_staff uuid;
  v_count int;
begin
  perform 1 from salons s where s.id = p_salon_id for update;
  if not found then raise exception 'SALON_NOT_FOUND'; end if;

  select count(*) into v_count from lanes l where l.salon_id = p_salon_id and l.is_active;
  if v_count >= 10 then raise exception 'TOO_MANY_BARBERS'; end if;

  if exists (select 1 from salon_staff st where st.phone = p_phone) then
    raise exception 'PHONE_TAKEN';
  end if;

  insert into lanes (salon_id, name) values (p_salon_id, p_name) returning id into v_lane;

  begin
    insert into salon_staff (salon_id, name, phone, password_hash, role, lane_id)
    values (p_salon_id, p_name, p_phone, p_password_hash, 'BARBER', v_lane)
    returning id into v_staff;
  exception when unique_violation then
    raise exception 'PHONE_TAKEN';   -- two requests racing on the same number
  end;

  return query select v_staff, v_lane;
end;
$$;

create or replace function public.set_staff_active(p_salon_id uuid, p_staff_id uuid, p_active boolean)
returns void
language plpgsql
as $$
declare
  v_lane uuid;
  v_count int;
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
  else
    -- Until customers can be moved between lanes (a later slice), a lane with people in it stays on.
    if exists (
      select 1 from queue_entries e join queues q on q.id = e.queue_id
      where e.lane_id = v_lane and q.date = current_date
        and e.status in ('WAITING', 'CALLED', 'SERVING')
    ) then
      raise exception 'LANE_HAS_CUSTOMERS';
    end if;
  end if;

  update salon_staff set is_active = p_active where id = p_staff_id;
  update lanes set is_active = p_active where id = v_lane;
end;
$$;

revoke all on function public.add_staff_with_lane(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.add_staff_with_lane(uuid, text, text, text) to service_role;
revoke all on function public.set_staff_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_staff_active(uuid, uuid, boolean) to service_role;

commit;

notify pgrst, 'reload schema';