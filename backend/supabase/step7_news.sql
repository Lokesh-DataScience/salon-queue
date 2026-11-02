create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  place_key text not null unique,          -- "state/district", lower-cased
  district text,
  state text,
  created_at timestamptz not null default now(),
  constraint places_has_region check (district is not null or state is not null)
);

alter table salons add column if not exists place_id uuid references places(id) on delete set null;
create index if not exists salons_place_id_idx on salons (place_id);

create table if not exists news_feeds (
  feed_key text primary key,
  query text not null,
  fetched_at timestamptz,
  last_attempt_at timestamptz
);

create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  feed_key text not null references news_feeds(feed_key) on delete cascade,
  position int not null,
  title text not null,
  url text not null,
  source text,
  published_at timestamptz
);
create index if not exists news_items_feed_idx on news_items (feed_key, position);

alter table places enable row level security;
alter table news_feeds enable row level security;
alter table news_items enable row level security;

create or replace function assign_salon_place(
  p_salon_id uuid, p_key text, p_district text, p_state text
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into places (place_key, district, state)
  values (p_key, p_district, p_state)
  on conflict (place_key) do update set place_key = excluded.place_key
  returning id into v_id;
  update salons set place_id = v_id where id = p_salon_id;
  return v_id;
end $$;

create or replace function replace_news_items(p_feed_key text, p_query text, p_items jsonb)
returns void language plpgsql as $$
begin
  insert into news_feeds (feed_key, query, fetched_at, last_attempt_at)
  values (p_feed_key, p_query, now(), now())
  on conflict (feed_key) do update
    set query = excluded.query, fetched_at = now(), last_attempt_at = now();
  delete from news_items where feed_key = p_feed_key;
  insert into news_items (feed_key, position, title, url, source, published_at)
  select p_feed_key, ord::int, i->>'title', i->>'url', i->>'source', (i->>'publishedAt')::timestamptz
  from jsonb_array_elements(p_items) with ordinality as t(i, ord);
end $$;

revoke all on function assign_salon_place(uuid, text, text, text) from public, anon, authenticated;
revoke all on function replace_news_items(text, text, jsonb) from public, anon, authenticated;
grant execute on function assign_salon_place(uuid, text, text, text) to service_role;
grant execute on function replace_news_items(text, text, jsonb) to service_role;