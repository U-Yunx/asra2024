-- v2.4.1 — Baseline capture of public_user_stats
-- Security note: SECURITY DEFINER callable by anon/authenticated on purpose,
-- returns ONLY aggregate platform counts (no per-user rows exposed).
create or replace function public.public_user_stats()
returns table (registered bigint, active_24h bigint, active_7d bigint, active_30d bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*) as registered,
    count(*) filter (where last_active > now() - interval '24 hours') as active_24h,
    count(*) filter (where last_active > now() - interval '7 days') as active_7d,
    count(*) filter (where last_active > now() - interval '30 days') as active_30d
  from public.profiles;
$$;

revoke execute on function public.public_user_stats() from public;
grant execute on function public.public_user_stats() to anon, authenticated;