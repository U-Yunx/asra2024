import { describe, expect, it } from 'vitest'
import { CURRENCIES, convertPrice, formatCurrency } from './currency'

describe('currency helpers', () => {
  it('keeps USD conversion identity', () => {
    expect(convertPrice(100, 'USD', 'USD')).toBe(100)
  })

  it('converts between display currencies', () => {
    // 100 USD -> IDR at 16,200/USD
    const idr = convertPrice(100, 'USD', 'IDR')
    expect(idr).toBeCloseTo(1_620_000, 0)
  })

  it('round-trips back to USD', () => {
    const idr = convertPrice(100, 'USD', 'IDR')
    expect(convertPrice(idr, 'IDR', 'USD')).toBeCloseTo(100, 2)
  })

  it('formats currency with its symbol', () => {
    expect(formatCurrency(162000, 'IDR')).toContain('Rp')
    expect(formatCurrency(162000, 'IDR')).toContain('162,000')
    expect(formatCurrency(12.5, 'USD')).toContain('$')
  })

  it('exposes a currency list with rates', () => {
    expect(CURRENCIES.length).toBeGreaterThan(3)
    expect(CURRENCIES.find((c) => c.code === 'USD')?.rate).toBe(1)
  })
})