-- ---------------------------------------------------------------------------
-- Auto token store: make `app_secrets` the secure, service-role-only home for
-- every third-party token the app reads (MetaApi, OANDA, market-data providers,
-- news, the robot's cron token). Saving no longer needs a manually-created
-- Supabase Personal Access Token — edge functions write with the auto-injected
-- service-role key, authorized by the admin's signed-in session.
--
-- `app_secrets` already exists (used by market-data + robot-runner). This
-- migration hardens it: RLS stays ON and NO policies are created, so the anon
-- and authenticated roles can never read or write tokens (deny-all); only the
-- service role bypasses RLS. Explicit REVOKEs guard even against a future
-- "RLS disabled" mishap.
-- ---------------------------------------------------------------------------
alter table public.app_secrets enable row level security;

revoke all on public.app_secrets from anon, authenticated;
revoke all on public.app_secrets from public;

-- The service role (edge functions) keeps full access.
grant select, insert, update, delete on public.app_secrets to service_role;

-- Index used by every lookup (primary key covers it, but an explicit btree
-- keeps plans stable when the table grows beyond the tiny in-memory size).
create index if not exists app_secrets_key_idx on public.app_secrets (key);
