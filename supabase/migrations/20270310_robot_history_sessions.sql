create table if not exists public.robot_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.paper_accounts (id) on delete cascade,
  method text,
  strategy text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check (status in ('running','finished')),
  initial_balance numeric not null default 0,
  final_balance numeric,
  pnl numeric,
  trade_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.robot_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.paper_accounts (id) on delete cascade,
  session_id uuid references public.robot_sessions (id) on delete cascade,
  recorded_at timestamptz not null default now(),
  balance numeric not null default 0,
  equity numeric not null default 0,
  unrealized numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists robot_sessions_user_idx on public.robot_sessions (user_id, started_at desc);
create index if not exists robot_history_user_time_idx on public.robot_history (user_id, recorded_at asc);
create index if not exists robot_history_session_idx on public.robot_history (session_id);

alter table public.robot_sessions enable row level security;
alter table public.robot_history enable row level security;

create policy "owner select sessions" on public.robot_sessions
  for select using (auth.uid() = user_id);
create policy "owner insert sessions" on public.robot_sessions
  for insert with check (auth.uid() = user_id);
create policy "owner update sessions" on public.robot_sessions
  for update using (auth.uid() = user_id);
create policy "owner delete sessions" on public.robot_sessions
  for delete using (auth.uid() = user_id);

create policy "owner select history" on public.robot_history
  for select using (auth.uid() = user_id);
create policy "owner insert history" on public.robot_history
  for insert with check (auth.uid() = user_id);
create policy "owner update history" on public.robot_history
  for update using (auth.uid() = user_id);
create policy "owner delete history" on public.robot_history
  for delete using (auth.uid() = user_id);