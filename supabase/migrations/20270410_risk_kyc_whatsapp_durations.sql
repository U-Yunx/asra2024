-- Risk disclaimer, KYC fields, WhatsApp notification prefs and billing
-- durations for packages / add-ons.
--
-- v2.9 — profiles gain the columns behind the Profile page (risk_accepted,
-- real_name, identity_status + timestamps, whatsapp_* prefs). Packages and
-- add-ons become purchasable in variable billing durations (1/7/30/90/180/365
-- days) instead of a fixed 30-day term, and subscriptions / add-on purchases
-- snapshot the duration the buyer chose.

-- --------------------------------- profiles ---------------------------------

alter table public.profiles
  add column if not exists real_name text,
  add column if not exists identity_status text not null default 'unverified'
    check (identity_status in ('unverified','pending','verified','rejected')),
  add column if not exists identity_document text,
  add column if not exists identity_submitted_at timestamptz,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_reason text,
  add column if not exists risk_accepted boolean not null default false,
  add column if not exists risk_accepted_at timestamptz,
  add column if not exists whatsapp_phone text,
  add column if not exists whatsapp_enabled boolean not null default false,
  add column if not exists whatsapp_daily_summary boolean not null default false,
  add column if not exists whatsapp_trade_summary boolean not null default false,
  add column if not exists whatsapp_robot_events boolean not null default false,
  add column if not exists whatsapp_maintenance boolean not null default false,
  add column if not exists last_active timestamptz;

-- -------------------------------- durations ---------------------------------

alter table public.packages
  add column if not exists duration_days integer not null default 30
    check (duration_days in (1, 7, 30, 90, 180, 365));

alter table public.subscriptions
  add column if not exists duration_days integer not null default 30
    check (duration_days in (1, 7, 30, 90, 180, 365));

alter table public.addons
  add column if not exists duration_days integer not null default 30
    check (duration_days in (1, 7, 30, 90, 180, 365));

alter table public.addon_purchases
  add column if not exists duration_days integer not null default 30
    check (duration_days in (1, 7, 30, 90, 180, 365));

-- ------------------------------- timestamps ---------------------------------

-- Kept here so the Profile / KYC audit trail records when things happened.
create or replace function public.touch_profile_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.identity_status = 'pending' and old.identity_status is distinct from 'pending' then
    new.identity_submitted_at = now();
  end if;
  if new.identity_status = 'verified' and old.identity_status is distinct from 'verified' then
    new.identity_verified_at = now();
  end if;
  return new;
end $$;

drop trigger if exists profiles_touch_identity_stamp on public.profiles;
create trigger profiles_touch_identity_stamp before update on public.profiles
  for each row execute function public.touch_profile_stamp();
