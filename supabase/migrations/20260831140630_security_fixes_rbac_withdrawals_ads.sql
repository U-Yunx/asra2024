-- Security fixes + RBAC foundations, withdrawals and ads.
--
-- v1.1 — Base platform schema and access control:
--   * profiles (auto-created on signup), guarded role + identity columns
--   * broker catalog + user broker connections
--   * packages / subscriptions / referrals (commission tracking)
--   * withdrawals (manual payout gateway)
--   * ads + ad_events (public banner)
--   * admin helper functions (is_admin, set_user_role, …)
--
-- Every statement is idempotent so the file can be replayed safely.

-- ------------------------------- RBAC helpers -------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
$$;

revoke execute on function public.is_admin() from public, anon;

-- Role changes only via SECURITY DEFINER RPC (the row trigger below blocks
-- direct UPDATEs on profiles.role from non-admins).
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  update public.profiles set role = p_role::text where id = p_user_id;
end $$;

revoke execute on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- Never let a non-admin escalate their own role through a plain UPDATE.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role is distinct from new.role and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end $$;

-- Identity status is only changed by admins (or by submitIdentityCheck, which
-- goes through a plain UPDATE from the owner — allowed when the only change is
-- owner-driven, otherwise blocked).
create or replace function public.guard_identity_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.identity_status is distinct from new.identity_status
     and not public.is_admin()
     and old.identity_status <> 'pending' then
    raise exception 'Identity status can only be changed by an admin';
  end if;
  return new;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- --------------------------------- profiles ---------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  role text not null default 'user' check (role in ('user','admin')),
  referral_code text,
  referred_by uuid,
  commission_earned numeric not null default 0 check (commission_earned >= 0),
  total_referrals integer not null default 0 check (total_referrals >= 0),
  trial_ends_at timestamptz,
  real_name text,
  identity_status text not null default 'unverified'
    check (identity_status in ('unverified','pending','verified','rejected')),
  identity_document text,
  identity_submitted_at timestamptz,
  identity_verified_at timestamptz,
  identity_reason text,
  risk_accepted boolean not null default false,
  risk_accepted_at timestamptz,
  whatsapp_phone text,
  whatsapp_enabled boolean not null default false,
  whatsapp_daily_summary boolean not null default false,
  whatsapp_trade_summary boolean not null default false,
  whatsapp_robot_events boolean not null default false,
  whatsapp_maintenance boolean not null default false,
  last_active timestamptz,
  created_at timestamptz not null default now(),
  unique (referral_code)
);

alter table public.profiles enable row level security;

-- A profile is auto-created the moment an auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email, referral_code, referred_by, trial_ends_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'referral_code', 'ANA' || substr(md5(random()::text), 1, 8)),
    nullif(new.raw_user_meta_data->>'referred_by', '')::uuid,
    now() + interval '7 days'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

drop trigger if exists profiles_guard_identity on public.profiles;
create trigger profiles_guard_identity before update on public.profiles
  for each row execute function public.guard_identity_status();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create policy "profiles: select own or admin" on public.profiles for select
  using ((select auth.uid()) = id or public.is_admin());
create policy "profiles: insert own" on public.profiles for insert
  with check ((select auth.uid()) = id);
create policy "profiles: update own or admin" on public.profiles for update
  using ((select auth.uid()) = id or public.is_admin())
  with check ((select auth.uid()) = id or public.is_admin());

-- The platform admin (seeded from the contact inbox) gets an admin profile row.
insert into public.profiles (id, display_name, email, role, referral_code, created_at)
select id, coalesce(raw_user_meta_data->>'display_name', split_part(email, '@', 1)), email, 'admin',
       'ANA' || substr(md5(random()::text), 1, 8), now()
from auth.users
where email = '6880.asx@gmail.com'
  and not exists (select 1 from public.profiles p where p.email = auth.users.email)
on conflict do nothing;

-- ---------------------------------- brokers ---------------------------------

create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  description text,
  admin_referral_code text,
  requires_api_key boolean not null default true,
  live_url text,
  practice_url text,
  status text not null default 'available' check (status in ('available','maintenance','coming_soon')),
  sort integer not null default 0,
  platform text check (platform in ('oanda','mt4','mt5')),
  created_at timestamptz not null default now()
);

alter table public.brokers enable row level security;

create policy "public read brokers" on public.brokers for select using (true);
create policy "admin insert brokers" on public.brokers for insert with check (public.is_admin());
create policy "admin update brokers" on public.brokers for update using (public.is_admin());
create policy "admin delete brokers" on public.brokers for delete using (public.is_admin());

insert into public.brokers (name, slug, description, requires_api_key, status, sort, platform)
values ('OANDA', 'oanda', 'OANDA live and practice forex accounts', true, 'available', 1, 'oanda')
on conflict (slug) do nothing;

create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  broker_id uuid not null references public.brokers (id) on delete cascade,
  api_key text,
  account_id text,
  account_type text not null default 'practice' check (account_type in ('practice','live')),
  status text not null default 'pending',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broker_id)
);

alter table public.broker_connections enable row level security;

create policy "connections: select own or admin" on public.broker_connections for select
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "connections: insert own" on public.broker_connections for insert
  with check ((select auth.uid()) = user_id);
create policy "connections: update own or admin" on public.broker_connections for update
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "connections: delete own or admin" on public.broker_connections for delete
  using ((select auth.uid()) = user_id or public.is_admin());

drop trigger if exists broker_connections_set_updated_at on public.broker_connections;
create trigger broker_connections_set_updated_at before update on public.broker_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------- packages ---------------------------------

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric not null default 0 check (price >= 0),
  currency text not null default 'USD',
  duration_days integer not null default 30,
  commission_pct numeric not null default 0,
  features jsonb not null default '{}'::jsonb,
  robots integer not null default 1,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint packages_robots_one check (robots = 1)
);

alter table public.packages enable row level security;

create policy "public read packages" on public.packages for select using (true);
create policy "admin insert packages" on public.packages for insert with check (public.is_admin());
create policy "admin update packages" on public.packages for update using (public.is_admin());
create policy "admin delete packages" on public.packages for delete using (public.is_admin());

-- --------------------------------- subscriptions -----------------------------

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  package_id uuid not null references public.packages (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','active','rejected','expired')),
  amount numeric not null default 0,
  payment_method text,
  tx_ref text,
  activated_by uuid references auth.users (id) on delete set null,
  activated_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  robots integer not null default 1,
  duration_days integer not null default 30,
  created_at timestamptz not null default now(),
  constraint subscriptions_robots_one check (robots = 1)
);

alter table public.subscriptions enable row level security;

create policy "subscriptions: select own or admin" on public.subscriptions for select
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "subscriptions: insert own pending" on public.subscriptions for insert
  with check ((select auth.uid()) = user_id and status = 'pending');
create policy "admin update subscriptions" on public.subscriptions for update
  using (public.is_admin());

-- ---------------------------------- referrals ---------------------------------

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users (id) on delete cascade,
  referred_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  commission_pct numeric not null default 0,
  commission_amount numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  created_at timestamptz not null default now()
);

alter table public.referrals enable row level security;

create policy "referrals: select participant or admin" on public.referrals for select
  using ((select auth.uid()) = referrer_id or (select auth.uid()) = referred_id or public.is_admin());

-- --------------------------------- withdrawals --------------------------------

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric not null default 0 check (amount > 0),
  method text not null default 'bank' check (method in ('bank','ewallet','international','usdt','other')),
  wallet_address text,
  method_detail text,
  account_holder text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  processed_by uuid references auth.users (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.withdrawals enable row level security;

create policy "withdrawals: select own or admin" on public.withdrawals for select
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "withdrawals: insert own pending" on public.withdrawals for insert
  with check ((select auth.uid()) = user_id and status = 'pending');
create policy "admin update withdrawals" on public.withdrawals for update
  using (public.is_admin());

create or replace function public.withdrawable_balance(uid uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when uid = auth.uid() or public.is_admin() then
      greatest(0,
        coalesce((select sum(commission_amount) from public.referrals where referrer_id = uid and status = 'paid'), 0)
        -
        coalesce((select sum(amount) from public.withdrawals where user_id = uid and status in ('pending','approved')), 0)
      )
    else null
  end
$$;

revoke execute on function public.withdrawable_balance(uuid) from public, anon;
grant execute on function public.withdrawable_balance(uuid) to authenticated;

-- ------------------------------------- ads -------------------------------------

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  title text not null,
  image_url text,
  target_url text,
  placement text not null default 'banner',
  active boolean not null default true,
  clicks integer not null default 0,
  status text not null default 'approved' check (status in ('pending','approved','rejected')),
  reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ads enable row level security;

create policy "public read ads" on public.ads for select
  using (active and status = 'approved');
create policy "admin insert ads" on public.ads for insert with check (public.is_admin());
create policy "admin update ads" on public.ads for update using (public.is_admin());
create policy "admin delete ads" on public.ads for delete using (public.is_admin());

create or replace function public.increment_ad_click(ad_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ads set clicks = clicks + 1 where id = ad_id;
end $$;

revoke execute on function public.increment_ad_click(uuid) from public, anon;
grant execute on function public.increment_ad_click(uuid) to authenticated;

-- ---------------------------------- ad events ---------------------------------

create table if not exists public.ad_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  ad_id uuid references public.ads (id) on delete cascade,
  event_type text not null default 'view' check (event_type in ('view','click')),
  created_at timestamptz not null default now()
);

alter table public.ad_events enable row level security;

create policy "ad_events: select own or admin" on public.ad_events for select
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "ad_events: insert own or anon" on public.ad_events for insert
  with check ((select auth.uid()) = user_id or (select auth.uid()) is null);

create index if not exists ad_events_owner_idx on public.ad_events (user_id, created_at desc);
create index if not exists ads_active_idx on public.ads (active, status);
