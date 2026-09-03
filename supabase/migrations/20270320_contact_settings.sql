-- v2.7 — Public Contact page.
-- contact_settings: a single row (id = 1) holding the contact details shown on
-- the public /contact page (email, WhatsApp, phone). Public read so visitors
-- see it; only admins may edit (from Admin › Settings › Contact).

create table if not exists public.contact_settings (
  id int primary key default 1 check (id = 1),
  email text not null default '',
  whatsapp text not null default '',
  phone text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.contact_settings enable row level security;

create policy "public read contact settings" on public.contact_settings for select using (true);
create policy "admin insert contact settings" on public.contact_settings for insert with check (public.is_admin());
create policy "admin update contact settings" on public.contact_settings for update using (public.is_admin());

-- Seed with the platform inbox used elsewhere (footer / creator credit).
insert into public.contact_settings (id, email, whatsapp, phone)
values (1, '6880.asx@gmail.com', '', '')
on conflict (id) do nothing;