-- v2.7 — User-submitted ads.
--
-- ads become user-submittable: a user who bought an "ads" add-on can create
-- their own ads on /my-ads. Each submission starts as status = 'pending' and
-- only goes live after an admin approves it (Admin › Ads). Owners can
-- read/update/delete their own rows; the public banner only shows
-- approved + active ads.
--
-- addons.kind now also accepts 'ads' (an "Ad slot" purchase grants the right
-- to run N of your own ads).

alter table public.ads add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.ads add column if not exists status text not null default 'approved'
  check (status in ('pending','approved','rejected'));
alter table public.ads add column if not exists reason text;
alter table public.ads add column if not exists reviewed_at timestamptz;
alter table public.ads add column if not exists reviewed_by uuid references auth.users (id) on delete set null;
create index if not exists ads_owner_idx on public.ads (user_id, status, created_at desc);

-- Replace the old admin-only ads policies with owner-aware ones.
drop policy if exists "public read ads" on public.ads;
drop policy if exists "admin insert ads" on public.ads;
drop policy if exists "admin update ads" on public.ads;
drop policy if exists "admin delete ads" on public.ads;

-- Public visitors only see approved + active ads. Admins see everything.
-- Owners can read their own rows (pending, rejected or live).
create policy "public read ads" on public.ads for select
  using ((active and status = 'approved') or public.is_admin() or auth.uid() = user_id);
create policy "insert ads" on public.ads for insert
  with check (public.is_admin() or (auth.uid() = user_id and status = 'pending'));
create policy "update ads" on public.ads for update
  using (public.is_admin() or auth.uid() = user_id)
  with check (public.is_admin() or (auth.uid() = user_id and status = 'pending'));
create policy "delete ads" on public.ads for delete
  using (public.is_admin() or auth.uid() = user_id);

-- ------------------------------ ads add-on kind ------------------------------

alter table public.addons drop constraint if exists addons_kind_check;
alter table public.addons add constraint addons_kind_check check (kind in ('robot','mt_account','ads'));

-- Seed an "Ad slot" add-on (placeholder pricing — admin edits real price).
insert into public.addons (name, description, kind, amount, price, currency, active, sort) values
  ('Ad slot', 'Run one of your own ads in the global banner after admin approval.', 'ads', 1, 19, 'USDT', true, 5)
on conflict do nothing;