-- Widen the withdrawal method check so payout accounts can be local bank,
-- Indonesian e-wallet, international e-wallet, USDT/crypto or other.
alter table public.withdrawals
  drop constraint if exists withdrawals_method_check;
alter table public.withdrawals
  add constraint withdrawals_method_check
  check (method in ('bank','ewallet','international','usdt','other'));