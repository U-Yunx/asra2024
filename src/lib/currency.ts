/**
 * Display-currency conversion for the header picker and price badges.
 *
 * These are display-only rates (rough daily mid-rates) used to convert how a
 * price is *shown* — they never touch the actual USD ledger, trades or payouts.
 */
import { useCallback, useState } from 'react'

export interface CurrencyDef {
  code: string
  name: string
  symbol: string
  /** USD mid-rate used for display conversion (1 USD = `rate` units). */
  rate: number
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', rate: 16_200 },
  { code: 'EUR', name: 'Euro', symbol: '€', rate: 0.92 },
  { code: 'GBP', name: 'British Pound', symbol: '£', rate: 0.79 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', rate: 1.34 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', rate: 4.7 },
]

export type CurrencyCode = (typeof CURRENCIES)[number]['code']

const KEY = 'ana24.display-currency'

function loadCurrency(): CurrencyCode {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw && CURRENCIES.some((c) => c.code === raw)) return raw as CurrencyCode
  } catch {
    /* noop */
  }
  return 'USD'
}

/** Display currency for the session, persisted to localStorage. */
export function useCurrency() {
  const [currency, setCurrencyState] = useState<CurrencyCode>(loadCurrency)
  const setCurrency = useCallback((code: CurrencyCode) => {
    setCurrencyState(code)
    try {
      localStorage.setItem(KEY, code)
    } catch {
      /* noop */
    }
  }, [])
  return { currency, setCurrency }
}

/** Convert an amount from one display currency to another (display only). */
export function convertPrice(amount: number, from: string, to: string): number {
  const fromRate = CURRENCIES.find((c) => c.code === from)?.rate ?? 1
  const toRate = CURRENCIES.find((c) => c.code === to)?.rate ?? 1
  if (fromRate <= 0 || toRate <= 0) return amount
  return (amount / fromRate) * toRate
}

/** Format an amount in a display currency, e.g. "Rp 162,000". */
export function formatCurrency(amount: number, code: string): string {
  const def = CURRENCIES.find((c) => c.code === code)
  const symbol = def?.symbol ?? code
  const decimals = code === 'IDR' ? 0 : 2
  return `${symbol} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}