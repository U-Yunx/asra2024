/**
 * Payment-method catalog for the manual payment gateway: labels for the
 * receiving-account methods (Packages / Admin) and the payout methods users can
 * withdraw earned commissions to (Gateway). Region data (Indonesian banks +
 * e-wallets) keeps the withdrawal form quick to fill in.
 */
import type { PaymentMethod, WithdrawalMethod } from './types'

/** Human labels for the admin-managed receiving accounts (Packages page). */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  qris: 'QRIS',
  bank: 'Bank transfer',
  ewallet: 'E-wallet',
  paypal: 'PayPal',
  usdt: 'USDT (crypto)',
}

/** A payout option shown on the Gateway withdrawal form. */
export interface WithdrawMethod {
  id: WithdrawalMethod
  label: string
  hint: string
}

export const WITHDRAW_METHODS: WithdrawMethod[] = [
  {
    id: 'bank',
    label: 'Bank transfer',
    hint: 'Transfers to a local bank account — usually 1–3 business days.',
  },
  {
    id: 'ewallet',
    label: 'E-wallet',
    hint: 'Instant-ish payouts to OVO, GoPay, DANA, ShopeePay or LinkAja.',
  },
  {
    id: 'international',
    label: 'International wire',
    hint: 'SWIFT / bank wire for accounts outside the default region.',
  },
  {
    id: 'usdt',
    label: 'USDT (crypto)',
    hint: 'Sent to a TRC-20, BEP-20 or ERC-20 USDT address.',
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'Any other payout arrangement — add the details in the form.',
  },
]

/** Default payout region shown in the Gateway UI. */
export const DEFAULT_WITHDRAW_COUNTRY = 'ID'

interface Country {
  code: string
  name: string
}

const COUNTRIES: Record<string, Country> = {
  ID: { code: 'ID', name: 'Indonesia' },
  MY: { code: 'MY', name: 'Malaysia' },
  SG: { code: 'SG', name: 'Singapore' },
  TH: { code: 'TH', name: 'Thailand' },
  VN: { code: 'VN', name: 'Vietnam' },
  PH: { code: 'PH', name: 'Philippines' },
  US: { code: 'US', name: 'United States' },
  GB: { code: 'GB', name: 'United Kingdom' },
  AE: { code: 'AE', name: 'United Arab Emirates' },
  IN: { code: 'IN', name: 'India' },
}

/** Resolve a country code to its display name (falls back to the code). */
export function getWithdrawCountry(code: string): { name: string } {
  return COUNTRIES[code.toUpperCase()] ?? { name: code.toUpperCase() }
}

/** Local bank options for the withdrawal form. */
export const INDONESIAN_BANKS: { name: string }[] = [
  { name: 'BCA' },
  { name: 'Mandiri' },
  { name: 'BNI' },
  { name: 'BRI' },
  { name: 'CIMB Niaga' },
  { name: 'Permata' },
  { name: 'Maybank' },
  { name: 'Dana' },
]

/** Local e-wallet options for the withdrawal form. */
export const INDONESIAN_EWALLETS: string[] = ['OVO', 'GoPay', 'DANA', 'ShopeePay', 'LinkAja']
