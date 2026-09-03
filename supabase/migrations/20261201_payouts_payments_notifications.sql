-- v2.3 — Payout accounts, admin-managed payment accounts (QRIS / local bank /
-- e-wallet / PayPal / USDT), and notifications for both users and admins.

-- 1. Saved withdrawal (payout) account per user. Users set this once and the
--    Wallet form reuses it, so an admin always sees where to send the money.
create table if not exists public.withdrawal_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null check (method in ('bank','ewallet','international','usdt','other')),
  label text not null default '',
  details jsonb not null default '{}'::jsonb,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, label)
);

-- Let a withdrawal record which specific bank/e-wallet/address it should be
-- paid to (the category stays in `method`, which keeps its check constraint).
alter table public.withdrawals
  add column if not exists method_detail text,
  add column if not exists account_holder text;

-- 2. Admin-managed receiving accounts shown on the Packages page so buyers can
--    see exactly where to transfer for QRIS, bank, e-wallet, PayPal or USDT.
create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  method text not null check (method in ('qris','bank','ewallet','paypal','usdt')),
  label text not null default '',
  details jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Notifications. user_id set -> that user only; user_id NULL -> broadcast to
--    every admin. Users see their own rows, admins additionally see broadcasts.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_owner_idx on public.notifications (user_id, created_at desc);

-- ----------------------------------- RLS -----------------------------------

alter table public.withdrawal_accounts enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.notifications enable row level security;

-- withdrawal_accounts: owner CRUD only.
create policy "owner select withdrawal accounts" on public.withdrawal_accounts for select using (auth.uid() = user_id);
create policy "owner insert withdrawal accounts" on public.withdrawal_accounts for insert with check (auth.uid() = user_id);
create policy "owner update withdrawal accounts" on public.withdrawal_accounts for update using (auth.uid() = user_id);
create policy "owner delete withdrawal accounts" on public.withdrawal_accounts for delete using (auth.uid() = user_id);

-- payment_accounts: anyone (incl. visitors) may read enabled rows — the
-- Packages page is public — but only admins may write.
create policy "public read enabled payment accounts" on public.payment_accounts for select using (enabled);
create policy "admin insert payment accounts" on public.payment_accounts for insert with check (public.is_admin());
create policy "admin update payment accounts" on public.payment_accounts for update using (public.is_admin());
create policy "admin delete payment accounts" on public.payment_accounts for delete using (public.is_admin());

-- notifications: own rows, or admin broadcasts if the reader is an admin.
create policy "owner select notifications" on public.notifications for select
  using (auth.uid() = user_id or (user_id is null and public.is_admin()));
create policy "owner update notifications" on public.notifications for update
  using (auth.uid() = user_id or (user_id is null and public.is_admin()));

-- ------------------------------- triggers ----------------------------------

drop trigger if exists withdrawal_accounts_set_updated_at on public.withdrawal_accounts;
create trigger withdrawal_accounts_set_updated_at before update on public.withdrawal_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists payment_accounts_set_updated_at on public.payment_accounts;
create trigger payment_accounts_set_updated_at before update on public.payment_accounts
  for each row execute function public.set_updated_at();

-- ----------------------------- notification API ----------------------------

-- Insert a notification. NULL user_id = broadcast to admins (admin-only). A
-- non-admin may only create notifications for themselves. Security definer so
-- RLS insert policies aren't needed. (Every param has a default so the function
-- can be called with any leading subset — required by Postgres.)
create or replace function public.create_notification(
  p_user_id uuid default null,
  p_type text default 'info',
  p_title text default 'Notification',
  p_body text default null,
  p_link text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is null and not public.is_admin() then
    raise exception 'Only admins can broadcast notifications.';
  end if;
  if p_user_id is not null and p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'You can only send notifications to yourself.';
  end if;
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, coalesce(p_type, 'info'), p_title, p_body, p_link)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.mark_notifications_read()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set read_at = now()
  where (user_id = auth.uid() or (user_id is null and public.is_admin()))
    and read_at is null;
end $$;

create or replace function public.unread_notifications_count()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)::bigint from public.notifications
  where (user_id = auth.uid() or (user_id is null and public.is_admin()))
    and read_at is null;
$$;

revoke execute on function public.create_notification(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_notification(uuid, text, text, text, text) to authenticated;
revoke execute on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;
revoke execute on function public.unread_notifications_count() from public, anon;
grant execute on function public.unread_notifications_count() to authenticated;

-- ------------------------- seed payment accounts ---------------------------
-- Placeholder rows so the Packages flow is immediately visible. Admin edits the
-- real details in Admin > Payments before taking live payments.
insert into public.payment_accounts (method, label, details, enabled, sort) values
  ('qris',   'QRIS — scan & pay',      '{"qr_ref":"Update QRIS reference in Admin › Payments","holder":"ANA24"}', true, 1),
  ('bank',   'Local bank transfer',    '{"bank_name":"BCA","account_holder":"Update in Admin › Payments","account_number":"0000000000"}', true, 2),
  ('ewallet','E-wallet (GoPay/OVO/DANA)','{"provider":"DANA","account_holder":"Update in Admin › Payments","account_id":"Update in Admin › Payments"}', true, 3),
  ('paypal', 'PayPal',                 '{"email":"Update in Admin › Payments"}', true, 4),
  ('usdt',   'USDT (TRC-20)',          '{"network":"TRC-20","wallet":"Update in Admin › Payments"}', true, 5)
on conflict do nothing;