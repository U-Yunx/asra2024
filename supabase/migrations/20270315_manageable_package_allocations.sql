-- Make per-package robot and MT4/5 account allocations configurable (was locked
-- to exactly 1 by cap_packages_one_robot_one_mt_account). Packages now carry
-- their own robot slot count and MT4/5 account count; subscriptions snapshot
-- both at purchase time so entitlement reflects the package the user bought.

-- 1) Packages: drop the "exactly 1 robot" constraint, enforce >= 1 instead.
alter table public.packages
  drop constraint if exists packages_robots_one;
alter table public.packages
  add constraint packages_robots_min check (robots >= 1);

-- 2) Packages: first-class MT4/5 account count (previously only in features.broker_connections).
alter table public.packages
  add column if not exists mt_accounts integer not null default 1;
update public.packages
  set mt_accounts = greatest(1, coalesce((features->>'broker_connections')::int, 1))
  where mt_accounts is null or mt_accounts < 1;
alter table public.packages
  add constraint packages_mt_accounts_min check (mt_accounts >= 1);

-- 3) Subscriptions: drop the "exactly 1 robot" constraint, enforce >= 1.
alter table public.subscriptions
  drop constraint if exists subscriptions_robots_one;
alter table public.subscriptions
  add constraint subscriptions_robots_min check (robots >= 1);

-- 4) Subscriptions: snapshot the MT4/5 account count at purchase.
alter table public.subscriptions
  add column if not exists mt_accounts integer not null default 1;
update public.subscriptions s
  set mt_accounts = greatest(1, coalesce((select p.mt_accounts from public.packages p where p.id = s.package_id), 1))
  where s.mt_accounts is null or s.mt_accounts < 1;
alter table public.subscriptions
  add constraint subscriptions_mt_accounts_min check (mt_accounts >= 1);