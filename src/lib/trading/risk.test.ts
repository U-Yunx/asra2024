/**
 * Risk-math unit tests, focused on micro-account sizing: a positive risk
 * budget must never round down to a zero-size order (the robot would silently
 * skip every pair on a small balance).
 */
import { describe, expect, it } from 'vitest'
import { suggestPositionUnits } from './risk'

describe('suggestPositionUnits — micro accounts', () => {
  it('never floors a positive risk budget to zero (micro floor of 1 unit)', () => {
    const units = suggestPositionUnits({
      equity: 10, // $10 micro account
      riskPct: 0.5, // 0.5% → $0.05 risk
      stopPips: 12,
      pipValue: 0.0001, // EUR/USD
    })
    expect(units).toBeGreaterThanOrEqual(1)
  })

  it('sizes whole units as usual on normal accounts', () => {
    // $100 risk at 1% of $10k / (20 pips × $0.0001 per pip per unit) = 50,000 units.
    const units = suggestPositionUnits({
      equity: 10_000,
      riskPct: 1,
      stopPips: 20,
      pipValue: 0.0001,
    })
    expect(units).toBe(50_000)
  })

  it('returns 0 when there is no risk budget or inputs are invalid', () => {
    expect(suggestPositionUnits({ equity: 0, riskPct: 1, stopPips: 20, pipValue: 0.0001 })).toBe(0)
    expect(suggestPositionUnits({ equity: 100, riskPct: 0, stopPips: 20, pipValue: 0.0001 })).toBe(0)
    expect(suggestPositionUnits({ equity: 100, riskPct: 1, stopPips: 0, pipValue: 0.0001 })).toBe(0)
    expect(suggestPositionUnits({ equity: 100, riskPct: 1, stopPips: 20, pipValue: 0 })).toBe(0)
  })
})
