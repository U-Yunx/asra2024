-- Identity verification on profiles (real name + manual admin review).
alter table public.profiles
  add column if not exists real_name text,
  add column if not exists identity_status text not null default 'unverified'
    check (identity_status in ('unverified','pending','verified','rejected')),
  add column if not exists identity_document text,
  add column if not exists identity_submitted_at timestamptz,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_reason text;

-- Guard identity transitions: only admins may verify/reject; a user request
-- stamps submission time and clears the previous decision.
create or replace function public.guard_identity_status()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.identity_status is distinct from old.identity_status
     and new.identity_status in ('verified','rejected')
     and not public.is_admin() then
    raise exception 'Only an admin can verify or reject an identity check.';
  end if;
  if new.identity_status is distinct from old.identity_status
     and new.identity_status = 'pending' then
    new.identity_submitted_at = now();
    new.identity_verified_at = null;
    new.identity_reason = null;
  end if;
  if new.identity_status is distinct from old.identity_status
     and new.identity_status in ('verified','rejected') then
    new.identity_verified_at = now();
  end if;
  return new;
end $$;

drop trigger if exists guard_identity_status on public.profiles;
create trigger guard_identity_status
  before update on public.profiles
  for each row execute function public.guard_identity_status();

-- A MetaTrader 4/5 account login can only ever be connected once (platform-wide).
-- Re-connecting the same account (same user, same broker) updates the existing
-- row via upsert, so the index is only hit for genuine duplicates.
create unique index if not exists broker_connections_mt_account_uniq
  on public.broker_connections (account_id)
  where platform in ('mt4','mt5') and account_id is not null and account_id <> '';

-- guard_identity_status is a trigger-only function; never expose it via RPC.
revoke execute on function public.guard_identity_status() from anon, authenticated;