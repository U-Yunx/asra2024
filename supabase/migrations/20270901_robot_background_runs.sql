-- Background robot execution (PRD: robot keeps trading while the page is closed)
-- ---------------------------------------------------------------------------
-- The browser mirrors its running robot into `robot_runs` and heartbeats while
-- the page is open. The scheduled `robot-runner` Edge Function (pg_cron, every
-- minute) takes over any run whose heartbeat goes stale (page closed or
-- refreshed) and keeps trading server-side with the exact same engine rules,
-- enforcing the auto-run duration, the session max-profit / max-loss guard and
-- the user's access. Only ledger-backed accounts (paper + managed live) are
-- mirrored — live OANDA / MetaTrader mirrors keep running in the browser only.

create table if not exists public.robot_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.paper_accounts (id) on delete cascade,
  robot_number int not null default 1,
  status text not null default 'running' check (status in ('running', 'stopped', 'finished')),
  method text not null default 'scalping' check (method in ('scalping', 'longterm')),
  strategy_mode text not null default 'auto' check (strategy_mode in ('auto', 'manual')),
  manual_strategy text check (manual_strategy in ('MA', 'RSI', 'MACD', 'BOLLINGER')),
  pairs text[] not null default '{}',
  auto_pick_pairs boolean not null default false,
  pair_count int not null default 5,
  trade_mode text not null default 'sequential' check (trade_mode in ('sequential', 'concurrent')),
  max_per_pair int not null default 1,
  max_open_trades int not null default 0,
  per_trade_take_profit_pips int not null default 0,
  per_trade_stop_loss_pips int not null default 0,
  overall_max_profit_usd numeric not null default 0,
  overall_max_loss_usd numeric not null default 0,
  size_multiplier real not null default 1,
  duration_minutes int,
  ends_at timestamptz,
  session_start_equity numeric,
  client_heartbeat_at timestamptz,
  last_tick_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id)
);

create index if not exists robot_runs_running_idx on public.robot_runs (status) where status = 'running';

alter table public.robot_runs enable row level security;

create policy "owner select robot_runs" on public.robot_runs
  for select using (auth.uid() = user_id);
create policy "owner insert robot_runs" on public.robot_runs
  for insert with check (auth.uid() = user_id);
create policy "owner update robot_runs" on public.robot_runs
  for update using (auth.uid() = user_id);
create policy "owner delete robot_runs" on public.robot_runs
  for delete using (auth.uid() = user_id);

-- Cron auth token for the scheduled robot-runner invocation (service-role only;
-- the Edge Function compares the `x-robot-token` header against this value).
insert into public.app_secrets (key, value)
values ('robot_runner_cron_token', gen_random_uuid()::text)
on conflict (key) do nothing;

-- Schedule the background robot to run every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'robot-runner') then
    perform cron.unschedule('robot-runner');
  end if;
end $$;

select cron.schedule('robot-runner', '* * * * *', $$
  select net.http_post(
    url := 'https://xopygzpepikerwqxzqzu.supabase.co/functions/v1/robot-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-robot-token', (select value from public.app_secrets where key = 'robot_runner_cron_token')
    ),
    body := '{}'
  );
$$);
