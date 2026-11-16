-- backend/supabase/step22_shop_customers.sql — Commerce Phase 1, C4: shop customers and device access (§4.4).
-- Run on the TESTS project first, with NOTHING highlighted. Ends with "step22 OK". Then run step23.
-- Production: run step22 then step23 BEFORE deploying the C4 backend. Safe to run twice.
--
--  shop_customers           one row per normalised phone; created with the first order's details;
--                           changed only from a verified device (C4b/C5), never by an unverified checkout (D22)
--  shop_access_profiles     a "device identity"; several devices can share one profile after device linking
--  shop_access_keys         one per device; only the SHA-256 of the HttpOnly cookie value is stored
--  shop_profile_customers   a profile proven to belong to a customer (founder callback or device link)
--  shop_verification_codes  short codes for recovery / device linking (hashed, expiring, single use)
-- A phone number, customer id or order number never grants access by itself (§9.4).

begin;

create table if not exists public.shop_customers (
  id                   uuid primary key default gen_random_uuid(),
  phone_e164           text not null unique check (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  display_name         text not null check (char_length(btrim(display_name)) between 1 and 80),
  address_line1        text not null check (char_length(btrim(address_line1)) between 3 and 200),
  address_line2        text not null default '' check (char_length(address_line2) <= 200),
  landmark             text not null default '' check (char_length(landmark) <= 120),
  pincode              text not null default '' check (pincode = '' or pincode ~ '^[1-9][0-9]{5}$'),
  details_verified_at  timestamptz,
  phone_verified_at    timestamptz,
  anonymised_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.shop_access_profiles (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table if not exists public.shop_access_keys (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.shop_access_profiles (id) on delete cascade,
  key_hash      text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index if not exists shop_access_keys_profile_idx on public.shop_access_keys (profile_id);

create table if not exists public.shop_profile_customers (
  profile_id            uuid not null references public.shop_access_profiles (id) on delete cascade,
  customer_id           uuid not null references public.shop_customers (id) on delete cascade,
  verified_at           timestamptz not null default now(),
  method                text not null check (method in ('FOUNDER_CALLBACK', 'DEVICE_LINK')),
  verified_by_staff_id  uuid references public.salon_staff (id) on delete restrict,
  primary key (profile_id, customer_id),
  constraint shop_profile_customers_staff check (method <> 'FOUNDER_CALLBACK' or verified_by_staff_id is not null)
);
create index if not exists shop_profile_customers_customer_idx on public.shop_profile_customers (customer_id);

create table if not exists public.shop_verification_codes (
  id                   uuid primary key default gen_random_uuid(),
  purpose              text not null check (purpose in ('RECOVERY', 'DEVICE_LINK')),
  customer_id          uuid references public.shop_customers (id) on delete cascade,
  profile_id           uuid references public.shop_access_profiles (id) on delete cascade,
  code_hash            text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at           timestamptz not null,
  attempts             integer not null default 0 check (attempts between 0 and 5),
  used_at              timestamptz,
  created_by_staff_id  uuid references public.salon_staff (id) on delete restrict,
  created_at           timestamptz not null default now(),
  -- RECOVERY: made by the founder for a customer. DEVICE_LINK: made by a device for its own profile.
  constraint shop_verification_codes_target check (
    (purpose = 'RECOVERY' and customer_id is not null and created_by_staff_id is not null)
    or (purpose = 'DEVICE_LINK' and profile_id is not null and created_by_staff_id is null)
  )
);
create index if not exists shop_verification_codes_lookup on public.shop_verification_codes (purpose, code_hash) where used_at is null;

drop trigger if exists shop_customers_set_updated_at on public.shop_customers;
create trigger shop_customers_set_updated_at before update on public.shop_customers
  for each row execute function public.set_updated_at();

alter table public.shop_customers enable row level security;
alter table public.shop_access_profiles enable row level security;
alter table public.shop_access_keys enable row level security;
alter table public.shop_profile_customers enable row level security;
alter table public.shop_verification_codes enable row level security;
revoke all on table public.shop_customers, public.shop_access_profiles, public.shop_access_keys,
  public.shop_profile_customers, public.shop_verification_codes from anon, authenticated;

do $$
begin
  if (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
      ('shop_customers','shop_access_profiles','shop_access_keys','shop_profile_customers','shop_verification_codes')) <> 5 then
    raise exception 'step22 check failed: a table is missing. Run the WHOLE file with nothing selected.';
  end if;
  if to_regclass('public.products') is null then raise exception 'step22 check failed: run step21 first.'; end if;
  raise notice 'step22 OK';
end $$;

commit;
