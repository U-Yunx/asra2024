-- REST API tokens for the broker bridges + the robot ↔ account link matrix.
--
-- v2.8 — broker_tokens gives every broker connection an auto-generated REST
-- token (issued/revoked from the Brokers page, validated server-side by the
-- broker-oanda / broker-mt edge functions before any order fires). The
-- robot_account_links table replaces the single robot_number on connections
-- with an explicit matrix (1 robot / 1 account, 1 robot / multi account,
-- multi robot / 1 account, multi robot / multi account) gated by the
-- subscription + add-on slot budget.

-- Paper/managed accounts now persist broker values beyond the original
-- paper|oanda constraint ('managed' lives on the platform ledger too).
alter table public.paper_accounts
  drop constraint if exists paper_accounts_broker_check;
alter table public.paper_accounts
  add constraint paper_accounts_broker_check
  check (broker in ('paper','oanda','managed','mt'));

-- --------------------------------- broker tokens --------------------------------

create table if not exists public.broker_tokens (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.broker_connections (id) on delete cascade,
  platform text not null default 'oanda',
  token text not null,
  masked text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id)
);

alter table public.broker_tokens enable row level security;

-- Only the connection owner (or an admin) may read/manage tokens. The raw token
-- is never SELECTed into the browser: the edge functions read it server-side.
create policy "owner select broker tokens" on public.broker_tokens for select
  using (
    exists (
      select 1 from public.broker_connections c
      where c.id = broker_tokens.connection_id
        and (c.user_id = (select auth.uid()) or public.is_admin())
    )
  );
create policy "owner insert broker tokens" on public.broker_tokens for insert
  with check (
    exists (
      select 1 from public.broker_connections c
      where c.id = broker_tokens.connection_id and c.user_id = (select auth.uid())
    )
  );
create policy "owner update broker tokens" on public.broker_tokens for update
  using (
    exists (
      select 1 from public.broker_connections c
      where c.id = broker_tokens.connection_id and c.user_id = (select auth.uid())
    )
  );
create policy "owner delete broker tokens" on public.broker_tokens for delete
  using (
    exists (
      select 1 from public.broker_connections c
      where c.id = broker_tokens.connection_id and c.user_id = (select auth.uid())
    )
  );

drop trigger if exists broker_tokens_set_updated_at on public.broker_tokens;
create trigger broker_tokens_set_updated_at before update on public.broker_tokens
  for each row execute function public.set_updated_at();

-- ----------------------------- robot account links -----------------------------

create table if not exists public.robot_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  robot_number int not null default 1 check (robot_number > 0),
  connection_id uuid not null references public.broker_connections (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, robot_number, connection_id)
);

alter table public.robot_account_links enable row level security;

create policy "owner select robot links" on public.robot_account_links for select
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "owner insert robot links" on public.robot_account_links for insert
  with check ((select auth.uid()) = user_id);
create policy "owner delete robot links" on public.robot_account_links for delete
  using ((select auth.uid()) = user_id);

create index if not exists robot_account_links_owner_idx on public.robot_account_links (user_id, robot_number);

-- Replace the full link matrix for a user in one transaction. The caller must
-- own every connection id (or be an admin); the write is still owner-scoped by
-- the RLS delete + insert policies, so this is a convenience wrapper.
create or replace function public.replace_robot_account_links(p_user_id uuid, p_links jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  link jsonb;
begin
  if p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only the account owner can change robot links';
  end if;
  delete from public.robot_account_links where user_id = p_user_id;
  for link in select * from jsonb_array_elements(p_links)
  loop
    insert into public.robot_account_links (user_id, robot_number, connection_id)
    values (
      p_user_id,
      coalesce((link->>'robot_number')::int, 1),
      (link->>'connection_id')::uuid
    );
  end loop;
end $$;

revoke execute on function public.replace_robot_account_links(uuid, jsonb) from public, anon;
grant execute on function public.replace_robot_account_links(uuid, jsonb) to authenticated;
