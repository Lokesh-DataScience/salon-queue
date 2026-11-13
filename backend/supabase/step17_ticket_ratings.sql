-- step17_ticket_ratings.sql
-- Customer app polish, slice 5: 1–5 star rating of a finished visit.
-- One rating per ticket (the customer can change it), only for COMPLETED tickets, authorised by the
-- ticket's access token in the API. Stars only: no text, no names, no phone numbers.
-- Customers see a salon's average once it has at least 5 ratings; the owner always sees it.
-- Additive and idempotent: safe on a live database and safe to re-run.
-- Run in the Supabase SQL editor with NOTHING highlighted.

create table if not exists public.ticket_ratings (
  ticket_id   uuid primary key references public.queue_entries (id) on delete cascade,
  salon_id    uuid not null references public.salons (id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ticket_ratings_salon_id_idx on public.ticket_ratings (salon_id);

drop trigger if exists ticket_ratings_set_updated_at on public.ticket_ratings;
create trigger ticket_ratings_set_updated_at
  before update on public.ticket_ratings
  for each row execute function set_updated_at();

-- The frontend never talks to Supabase directly; RLS with no policies blocks the anon key.
alter table public.ticket_ratings enable row level security;

-- How many ratings of each star a salon has (always 5 rows, 1..5).
create or replace function public.salon_rating_stats(p_salon_id uuid)
returns table (stars int, n int)
language sql
stable
as $$
  select s.stars, count(r.ticket_id)::int as n
  from generate_series(1, 5) as s(stars)
  left join public.ticket_ratings r on r.stars = s.stars and r.salon_id = p_salon_id
  group by s.stars
  order by s.stars;
$$;

revoke all on function public.salon_rating_stats(uuid) from public, anon, authenticated;
grant execute on function public.salon_rating_stats(uuid) to service_role;

-- ── Self-check ───────────────────────────────────────────────────────────
do $$
declare
  v_tbl int;
  v_rls boolean;
  v_rows int;
begin
  select count(*) into v_tbl from information_schema.tables
  where table_schema = 'public' and table_name = 'ticket_ratings';
  if v_tbl <> 1 then raise exception 'step17 FAILED: ticket_ratings missing'; end if;

  select relrowsecurity into v_rls from pg_class where oid = 'public.ticket_ratings'::regclass;
  if not v_rls then raise exception 'step17 FAILED: RLS is off on ticket_ratings'; end if;

  select count(*) into v_rows from public.salon_rating_stats('00000000-0000-0000-0000-000000000000');
  if v_rows <> 5 then raise exception 'step17 FAILED: salon_rating_stats should return 5 rows, got %', v_rows; end if;
end $$;

select 'step17 OK' as result;
