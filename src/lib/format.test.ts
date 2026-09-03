import { describe, expect, it } from 'vitest'
import { formatDateTime, formatNum, formatPct, formatPrice, formatUnits, formatUsd, timeAgo } from './format'

describe('format helpers', () => {
  it('formats USD currency with commas and cents', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(NaN)).toBe('—')
  })

  it('formats numbers with fixed decimals', () => {
    expect(formatNum(12.3456, 2)).toBe('12.35')
    expect(formatNum(99, 0)).toBe('99')
  })

  it('formats units as grouped integers', () => {
    expect(formatUnits(12345.6)).toBe('12,346')
  })

  it('formats signed percentages', () => {
    expect(formatPct(1.234)).toBe('+1.23%')
    expect(formatPct(-0.45)).toBe('-0.45%')
  })

  it('formats prices with adaptive decimals', () => {
    expect(formatPrice(1.08523)).toBe('1.0852')
    expect(formatPrice(1234.5)).toBe('1,234.50')
    expect(formatPrice(null)).toBe('—')
  })

  it('renders relative time and dates', () => {
    expect(timeAgo(null)).toBe('—')
    expect(timeAgo(new Date().toISOString())).toBe('just now')
    expect(formatDateTime('2026-03-04T14:22:00Z')).toMatch(/Mar 4/)
  })
})