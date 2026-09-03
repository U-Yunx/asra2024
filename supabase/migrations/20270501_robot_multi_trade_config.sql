-- Robot multi-trade / multi-pair configuration (PRD: docs/prd/robot-multi-trade.md)
-- ---------------------------------------------------------------------------
-- One row per (user, robot slot). Backward compatible: existing robots simply
-- have no row and fall back to the defaults (pairs = the single selected pair,
-- trade_mode = 'sequential', max_per_pair = 1, max_open_trades = 3), so a
-- single-pair robot behaves exactly as before.
--
-- Concurrency is enforced by counting OPEN positions per symbol (and in
-- total) at engine level; `paper_trades` already records per-symbol open
-- positions, so no separate tracking table is needed — the engine reads the
-- live account state each cycle.

create table if not exists public.robot_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  robot_number int not null default 1,
  name text not null default 'Robot 1',
  pairs text[] not null default '{}',
  trade_mode text not null default 'sequential'
    check (trade_mode in ('sequential', 'concurrent')),
  max_per_pair int not null default 1 check (max_per_pair >= 1),
  max_open_trades int not null default 3 check (max_open_trades >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, robot_number)
);

alter table public.robot_configs enable row level security;

create policy "Users can read their own robot configs"
  on public.robot_configs for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can create their own robot configs"
  on public.robot_configs for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own robot configs"
  on public.robot_configs for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own robot configs"
  on public.robot_configs for delete
  to authenticated
  using (user_id = auth.uid());