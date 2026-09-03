-- Packages advertise how many robots each subscription includes.
alter table public.packages add column if not exists robots int not null default 1;

-- Snapshot the granted robot count on the subscription so later package edits
-- never rewrite what a customer already paid for.
alter table public.subscriptions add column if not exists robots int not null default 1;

-- Broker connections now describe a trading platform account (OANDA, MT4, MT5)
-- and which robot slot it belongs to. A user may hold several accounts.
alter table public.broker_connections add column if not exists platform text not null default 'oanda' check (platform in ('oanda','mt4','mt5'));
alter table public.broker_connections add column if not exists server text;
alter table public.broker_connections add column if not exists robot_number int not null default 1;

-- Replace "one connection per user+broker" with "one per user+broker+robot slot".
alter table public.broker_connections drop constraint if exists broker_connections_user_id_broker_id_key;
alter table public.broker_connections add constraint broker_connections_user_broker_robot_key unique (user_id, broker_id, robot_number);

-- Seed the MT4 / MT5 platform catalog entries.
insert into public.brokers (name, slug, description, requires_api_key, status, sort)
select 'MetaTrader 4', 'mt4', 'MetaTrader 4 trading platform account', false, 'available', 2
where not exists (select 1 from public.brokers where slug = 'mt4');

insert into public.brokers (name, slug, description, requires_api_key, status, sort)
select 'MetaTrader 5', 'mt5', 'MetaTrader 5 trading platform account', false, 'available', 3
where not exists (select 1 from public.brokers where slug = 'mt5');