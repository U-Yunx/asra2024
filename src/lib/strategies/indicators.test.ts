import { describe, expect, it } from 'vitest'
import type { Bar, StrategyConfig } from '../types'
import { computeIndicators, ema, rsi, sma } from './indicators'

function bars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    time: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
    open: close,
    high: close,
    low: close,
    close,
  }))
}

const cfg = (type: StrategyConfig['type'], params: Record<string, number>): StrategyConfig => ({
  pair: 'EUR/USD',
  interval: '5min',
  type,
  params,
})

describe('indicators', () => {
  it('computes a simple moving average with leading nulls', () => {
    const out = sma([1, 2, 3, 4, 5], 3)
    expect(out[0]).toBeNull()
    expect(out[1]).toBeNull()
    expect(out[2]).toBeCloseTo(2)
    expect(out[4]).toBeCloseTo(4)
  })

  it('computes an exponential moving average of the right length', () => {
    const out = ema([1, 2, 3, 4, 5, 6, 7, 8], 3)
    expect(out).toHaveLength(8)
    expect(out[out.length - 1]).not.toBeNull()
  })

  it('keeps RSI between 0 and 100 and aligned to the bars', () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5)
    const out = rsi(values, 14)
    expect(out).toHaveLength(values.length)
    for (let i = 14; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(0)
      expect(out[i]).toBeLessThanOrEqual(100)
    }
  })

  it('returns the right series for each strategy type', () => {
    const b = bars(Array.from({ length: 60 }, (_, i) => 1.08 + Math.sin(i / 4) * 0.01))
    const ma = computeIndicators(b, cfg('MA', { fastPeriod: 5, slowPeriod: 20 }))
    expect(ma.fast?.length).toBe(60)
    expect(ma.slow?.[59]).not.toBeNull()

    const rsiInd = computeIndicators(b, cfg('RSI', { period: 14, oversold: 30, overbought: 70 }))
    expect(rsiInd.rsi?.[59]).not.toBeNull()

    const macd = computeIndicators(b, cfg('MACD', {}))
    expect(macd.histogram?.[59]).not.toBeNull()

    const bb = computeIndicators(b, cfg('BOLLINGER', { period: 20, stdDev: 2 }))
    expect(bb.upper?.[59]).not.toBeNull()
    expect(bb.lower?.[59]).not.toBeNull()
    expect(bb.middle?.[59]).not.toBeNull()
    expect(bb.upper![59]!).toBeGreaterThan(bb.lower![59]!)
  })
})