-- Ads pricing: optional price + currency on each ad (used for ad-slot
-- purchases / reporting in the admin Ads view).
alter table public.ads
  add column if not exists price numeric,
  add column if not exists price_currency text;