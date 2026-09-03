-- v2.5 — Performance: RLS initplan + covering indexes (Supabase advisor findings)
-- 1) RLS initplan: wrap auth.uid() in (select ...) so it's evaluated once per
--    query instead of per row. Semantics unchanged; official recommendation.
alter policy "ad_events: insert own or anon" on public.ad_events
  with check (((select auth.uid()) = user_id) or ((user_id is null) and ((select auth.uid()) is null)));
alter policy "ad_events: select own or admin" on public.ad_events
  using (((select auth.uid()) = user_id) or is_admin());

alter policy "owner insert addon purchases" on public.addon_purchases
  with check (((select auth.uid()) = user_id) and (status = 'pending'));
alter policy "owner select addon purchases" on public.addon_purchases
  using (((select auth.uid()) = user_id) or is_admin());

alter policy "connections: delete own or admin" on public.broker_connections
  using (((select auth.uid()) = user_id) or is_admin());
alter policy "connections: insert own" on public.broker_connections
  with check ((select auth.uid()) = user_id);
alter policy "connections: select own or admin" on public.broker_connections
  using (((select auth.uid()) = user_id) or is_admin());
alter policy "connections: update own or admin" on public.broker_connections
  using (((select auth.uid()) = user_id) or is_admin())
  with check (((select auth.uid()) = user_id) or is_admin());

alter policy "owner select notifications" on public.notifications
  using (((select auth.uid()) = user_id) or ((user_id is null) and is_admin()));
alter policy "owner update notifications" on public.notifications
  using (((select auth.uid()) = user_id) or ((user_id is null) and is_admin()));

alter policy "owner delete account" on public.paper_accounts
  using ((select auth.uid()) = user_id);
alter policy "owner insert account" on public.paper_accounts
  with check ((select auth.uid()) = user_id);
alter policy "owner select account" on public.paper_accounts
  using ((select auth.uid()) = user_id);
alter policy "owner update account" on public.paper_accounts
  using ((select auth.uid()) = user_id);

alter policy "owner delete trades" on public.paper_trades
  using ((select auth.uid()) = user_id);
alter policy "owner insert trades" on public.paper_trades
  with check ((select auth.uid()) = user_id);
alter policy "owner select trades" on public.paper_trades
  using ((select auth.uid()) = user_id);
alter policy "owner update trades" on public.paper_trades
  using ((select auth.uid()) = user_id);

alter policy "profiles: insert own" on public.profiles
  with check ((select auth.uid()) = id);
alter policy "profiles: select own or admin" on public.profiles
  using (((select auth.uid()) = id) or is_admin());
alter policy "profiles: update own or admin" on public.profiles
  using (((select auth.uid()) = id) or is_admin())
  with check (((select auth.uid()) = id) or is_admin());

alter policy "referrals: select participant or admin" on public.referrals
  using (((select auth.uid()) = referrer_id) or ((select auth.uid()) = referred_id) or is_admin());

alter policy "subscriptions: insert own pending" on public.subscriptions
  with check (((select auth.uid()) = user_id) and (status = 'pending'));
alter policy "subscriptions: select own or admin" on public.subscriptions
  using (((select auth.uid()) = user_id) or is_admin());

alter policy "owner delete withdrawal accounts" on public.withdrawal_accounts
  using ((select auth.uid()) = user_id);
alter policy "owner insert withdrawal accounts" on public.withdrawal_accounts
  with check ((select auth.uid()) = user_id);
alter policy "owner select withdrawal accounts" on public.withdrawal_accounts
  using ((select auth.uid()) = user_id);
alter policy "owner update withdrawal accounts" on public.withdrawal_accounts
  using ((select auth.uid()) = user_id);

alter policy "withdrawals: insert own pending" on public.withdrawals
  with check (((select auth.uid()) = user_id) and (status = 'pending'));
alter policy "withdrawals: select own or admin" on public.withdrawals
  using (((select auth.uid()) = user_id) or is_admin());

-- 2) Drop redundant authenticated-only profiles policies. The public policies
--    ("profiles: select own or admin", "profiles: insert own",
--    "profiles: update own or admin") already cover all signed-in users, so the
--    authenticated-only duplicates are dead weight. Keep profiles_delete_own
--    (no public DELETE policy exists).
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

-- 3) Covering indexes for unindexed foreign keys (INFO-level advisor finding).
create index if not exists addon_purchases_activated_by_idx on public.addon_purchases (activated_by);
create index if not exists addon_purchases_addon_id_idx on public.addon_purchases (addon_id);
create index if not exists broker_connections_broker_id_idx on public.broker_connections (broker_id);
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);
create index if not exists referrals_referred_id_idx on public.referrals (referred_id);
create index if not exists referrals_subscription_id_idx on public.referrals (subscription_id);
create index if not exists subscriptions_activated_by_idx on public.subscriptions (activated_by);
create index if not exists subscriptions_package_id_idx on public.subscriptions (package_id);
create index if not exists withdrawals_processed_by_idx on public.withdrawals (processed_by);