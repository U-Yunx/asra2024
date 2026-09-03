-- v2.6 — Add-on subscriptions: buy more robot slots and/or more MT4/5 accounts.
-- Sits on top of the existing package subscription.

-- 1. Add-on catalog
create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  kind text not null check (kind in ('robot','mt_account')),
  amount int not null default 1 check (amount > 0),
  price numeric not null default 0 check (price >= 0),
  currency text not null default 'USDT',
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists addons_active_sort_idx on public.addons (active, sort);

-- 2. Add-on purchases
create table if not exists public.addon_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  addon_id uuid not null references public.addons (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','active','rejected')),
  amount numeric not null default 0,
  currency text not null default 'USDT',
  payment_method text,
  tx_ref text,
  activated_by uuid references auth.users (id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists addon_purchases_owner_idx on public.addon_purchases (user_id, created_at desc);
create index if not exists addon_purchases_status_idx on public.addon_purchases (status, created_at desc);

-- RLS
alter table public.addons enable row level security;
alter table public.addon_purchases enable row level security;

create policy "public read addons" on public.addons for select
  using (active or public.is_admin());
create policy "admin insert addons" on public.addons for insert with check (public.is_admin());
create policy "admin update addons" on public.addons for update using (public.is_admin());
create policy "admin delete addons" on public.addons for delete using (public.is_admin());

create policy "owner select addon purchases" on public.addon_purchases for select
  using (auth.uid() = user_id or public.is_admin());
create policy "owner insert addon purchases" on public.addon_purchases for insert
  with check (auth.uid() = user_id and status = 'pending');
create policy "admin update addon purchases" on public.addon_purchases for update
  using (public.is_admin());

-- Seed add-ons
insert into public.addons (name, description, kind, amount, price, currency, active, sort) values
  ('Extra robot slot',      'Run one additional robot at the same time.', 'robot',       1,  29, 'USDT', true, 1),
  ('Robot slot pack (+3)',  'Run three additional robots at the same time.', 'robot',    3,  79, 'USDT', true, 2),
  ('Extra MT4/5 account',   'Connect one more MetaTrader 4/5 trading account.', 'mt_account', 1, 19, 'USDT', true, 3),
  ('MT4/5 account pack (+3)','Connect three more MetaTrader 4/5 trading accounts.', 'mt_account', 3, 49, 'USDT', true, 4)
on conflict do nothing;