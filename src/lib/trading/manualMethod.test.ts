/**
 * Tests for the manual trading-method ranking (manualTargets) and the
 * strategy-mode preferences (isStrategyType / loadRobotPrefs defaults).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bar, StrategyType } from '../types'
import { manualTargets } from './manualMethod'
import { isStrategyType, loadRobotPrefs } from './robotPrefs'

// Vitest runs in a node environment — provide a tiny localStorage shim so the
// prefs loader can be exercised without jsdom.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
})

afterEach(() => store.clear())

function bars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    time: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
    open: close,
    high: close,
    low: close,
    close,
  }))
}

/** Flat, low-volatility series — most strategies stay neutral. */
const FLAT = bars(Array.from({ length: 60 }, (_, i) => 1.08 + Math.sin(i / 4) * 0.0005))

/**
 * A deterministic RSI setup: a sustained decline pushes RSI below the
 * oversold threshold, then a recovery bar crosses it back up (but stays under
 * the midpoint) — the RSI strategy's classic buy signal on the last bar.
 */
function oversoldRecovery(flatLen: number, declineLen: number, dropPerBar: number, recoveryJump: number): Bar[] {
  const closes: number[] = Array(flatLen).fill(1.08)
  for (let i = 0; i < declineLen; i++) closes.push(1.08 - (i + 1) * dropPerBar)
  closes.push(closes[closes.length - 1] + recoveryJump) // sharp recovery
  return bars(closes)
}
const RSI_SETUP = oversoldRecovery(30, 8, 0.002, 0.006)

describe('manualTargets (manual trading method)', () => {
  it('ranks pairs and keeps only actionable signals', () => {
    const out = manualTargets({ 'EUR/USD': RSI_SETUP, 'GBP/USD': FLAT }, 'RSI', '5min')
    expect(out.length).toBeGreaterThan(0)
    // Ranked strongest first.
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score)
    }
    // Every kept pair has an actionable setup with the chosen strategy.
    for (const t of out) {
      expect(t.best).not.toBeNull()
      expect(t.best!.signal).not.toBe('neutral')
    }
    expect(out.map((t) => t.symbol)).toContain('EUR/USD')
    // The flat pair has no RSI signal — it must not be traded.
    expect(out.map((t) => t.symbol)).not.toContain('GBP/USD')
  })

  it('skips pairs with fewer than 30 bars', () => {
    const out = manualTargets({ 'EUR/USD': bars([1, 2, 3]) }, 'RSI', '5min')
    expect(out).toHaveLength(0)
  })

  it('supports every strategy type without throwing', () => {
    const types: StrategyType[] = ['MA', 'RSI', 'MACD', 'BOLLINGER']
    for (const type of types) {
      const out = manualTargets({ 'EUR/USD': RSI_SETUP, 'BTC/USD': RSI_SETUP }, type, '5min')
      expect(Array.isArray(out)).toBe(true)
    }
  })
})

describe('robotPrefs strategy mode', () => {
  it('isStrategyType only accepts the four supported strategies', () => {
    expect(isStrategyType('MA')).toBe(true)
    expect(isStrategyType('RSI')).toBe(true)
    expect(isStrategyType('MACD')).toBe(true)
    expect(isStrategyType('BOLLINGER')).toBe(true)
    expect(isStrategyType('WRONG')).toBe(false)
    expect(isStrategyType(undefined)).toBe(false)
    expect(isStrategyType(null)).toBe(false)
  })

  it('falls back to auto mode + MA when nothing is stored', () => {
    localStorage.clear()
    const p = loadRobotPrefs()
    expect(p.strategyMode).toBe('auto')
    expect(p.manualStrategy).toBe('MA')
  })
})
