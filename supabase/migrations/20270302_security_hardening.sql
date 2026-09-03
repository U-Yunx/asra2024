-- v2.4 — Security hardening (Supabase advisor findings)
-- 1) withdrawable_balance must not leak other users' balances: it is SECURITY
--    DEFINER and took an arbitrary uid, so any caller (incl. anon) could read
--    anyone's commission balance. Guard it to self (or admin) and drop anon.
create or replace function public.withdrawable_balance(uid uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when uid = auth.uid() or public.is_admin() then
      greatest(0,
        coalesce((select sum(commission_amount) from public.referrals where referrer_id = uid and status = 'paid'), 0)
        -
        coalesce((select sum(amount) from public.withdrawals where user_id = uid and status in ('pending','approved')), 0)
      )
    else null
  end
$$;

revoke execute on function public.withdrawable_balance(uuid) from public, anon;
grant execute on function public.withdrawable_balance(uuid) to authenticated;

-- 2) Trigger-only functions: give set_updated_at a fixed search_path, and revoke
--    the PUBLIC grant (anon/authenticated inherit it) so these can't be invoked
--    directly via /rest/v1/rpc. Triggers still fire — they run as the table owner.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

revoke execute on function public.guard_identity_status() from public, anon, authenticated;