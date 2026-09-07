-- Per-user MetaApi token management for MetaTrader connections.
--
-- The broker-mt bridge has always needed a platform-wide METAAPI_TOKEN secret
-- to proxy MT4/5 trading through MetaApi (metaapi.cloud). This migration lets
-- every user bring their own FREE MetaApi token instead: it is stored encrypted
-- at rest on the connection (same guard trigger as api_key / rest_api_token),
-- validated live against MetaApi's provisioning API ("security pass"), and used
-- to auto-provision + deploy the connected MT account ("auto-generate & inject
-- from the free provider"). The platform-wide secret remains the fallback when
-- the user hasn't added their own.

alter table public.broker_connections
  add column if not exists metaapi_token text,
  add column if not exists metaapi_token_masked text,
  add column if not exists metaapi_security text not null default 'none'
    check (metaapi_security in ('none','checking','passed','failed')),
  add column if not exists metaapi_security_note text,
  add column if not exists metaapi_token_checked_at timestamptz,
  add column if not exists metaapi_meta jsonb,
  add column if not exists metaapi_active boolean not null default false,
  add column if not exists metaapi_active_at timestamptz;

-- Encrypt the per-user MetaApi token at rest with the same credential key used
-- for api_key / rest_api_token (pgp_sym via public.encrypt_broker_cred). The
-- edge function stores plaintext; this trigger encrypts before it hits disk.
create or replace function public.guard_broker_cred_encrypt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.api_key is not null and new.api_key <> '' then
    new.api_key := public.encrypt_broker_cred(new.api_key);
  end if;
  if new.rest_api_token is not null and new.rest_api_token <> '' then
    new.rest_api_token := public.encrypt_broker_cred(new.rest_api_token);
  end if;
  if new.metaapi_token is not null and new.metaapi_token <> '' then
    new.metaapi_token := public.encrypt_broker_cred(new.metaapi_token);
  end if;
  return new;
end $$;

drop trigger if exists guard_broker_cred_encrypt on public.broker_connections;
create trigger guard_broker_cred_encrypt
  before insert or update of api_key, rest_api_token, metaapi_token
  on public.broker_connections
  for each row execute function public.guard_broker_cred_encrypt();

-- The raw token must never reach the browser. Column-level revoke hides it even
-- from SELECT * (PostgreSQL expands * to only the columns the caller may read),
-- so a compromised client session still cannot exfiltrate the credential. The
-- service-role edge function reads it server-side via decrypt_broker_cred.
revoke select (metaapi_token) on public.broker_connections from anon, authenticated;
