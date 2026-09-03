-- Paper trading: accounts + trades, owner-scoped RLS.

create table if not exists public.paper_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  broker text not null default 'paper' check (broker in ('paper','oanda')),
  currency text not null default 'USD',
  initial_balance numeric not null default 10000 check (initial_balance > 0),
  balance numeric not null default 10000,
  risk jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('long','short')),
  status text not null default 'open' check (status in ('open','closed')),
  quantity numeric not null default 0,
  entry_price numeric not null,
  entry_time timestamptz not null default now(),
  exit_price numeric,
  exit_time timestamptz,
  stop_loss numeric,
  take_profit numeric,
  pnl numeric,
  pnl_pct numeric,
  entry_equity numeric,
  close_reason text,
  strategy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paper_trades_user_idx on public.paper_trades (user_id, created_at desc);

alter table public.paper_accounts enable row level security;
alter table public.paper_trades enable row level security;

create policy "owner select account" on public.paper_accounts for select using (auth.uid() = user_id);
create policy "owner insert account" on public.paper_accounts for insert with check (auth.uid() = user_id);
create policy "owner update account" on public.paper_accounts for update using (auth.uid() = user_id);
create policy "owner delete account" on public.paper_accounts for delete using (auth.uid() = user_id);

create policy "owner select trades" on public.paper_trades for select using (auth.uid() = user_id);
create policy "owner insert trades" on public.paper_trades for insert with check (auth.uid() = user_id);
create policy "owner update trades" on public.paper_trades for update using (auth.uid() = user_id);
create policy "owner delete trades" on public.paper_trades for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists paper_accounts_set_updated_at on public.paper_accounts;
create trigger paper_accounts_set_updated_at before update on public.paper_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists paper_trades_set_updated_at on public.paper_trades;
create trigger paper_trades_set_updated_at before update on public.paper_trades
  for each row execute function public.set_updated_at();