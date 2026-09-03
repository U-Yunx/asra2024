import { describe, it, expect } from 'vitest'
import { createAccount, markToMarket, openPosition, runRobotCycle } from './engine'
import type { RatesMap, RobotConfig, RobotCycleInput } from './types'

const RATES: RatesMap = { 'EUR/USD': 1.085, 'GBP/USD': 1.27, 'USD/JPY': 151.2 }

function input(symbol: string, signal: RobotCycleInput['signal'] = 'buy', price?: number): RobotCycleInput {
  return {
    symbol,
    signal,
    price: price ?? RATES[symbol] ?? 1.0,
    rates: RATES,
    strategy: 'RSI · 5min',
    stopPips: 20,
    takeProfitPips: 40,
    units: 1000,
  }
}

function config(overrides: Partial<RobotConfig> = {}): RobotConfig {
  return { pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY'], tradeMode: 'sequential', maxPerPair: 1, maxOpenTrades: 3, ...overrides }
}

describe('runRobotCycle — multi-pair watchlist', () => {
  it('opens a trade on every qualifying pair in one cycle (sequential, no caps hit)', () => {
    const { state, events } = runRobotCycle(
      createAccount(10_000),
      [input('EUR/USD', 'buy'), input('GBP/USD', 'sell'), input('USD/JPY', 'neutral')],
      config(),
    )
    expect(state.positions).toHaveLength(2)
    expect(state.positions.map((p) => p.symbol).sort()).toEqual(['EUR/USD', 'GBP/USD'])
    expect(events.some((e) => e.startsWith('Opened EUR/USD long'))).toBe(true)
    expect(events.some((e) => e.startsWith('Opened GBP/USD short'))).toBe(true)
  })

  it('does not open on neutral signals and skips pairs with no signal', () => {
    const { state } = runRobotCycle(createAccount(10_000), [input('EUR/USD', 'neutral')], config())
    expect(state.positions).toHaveLength(0)
  })
})

describe('runRobotCycle — concurrent entries on one pair', () => {
  it('allows up to maxPerPair open positions on the same pair', () => {
    const cfg = config({ tradeMode: 'concurrent', maxPerPair: 2, maxOpenTrades: 5 })
    const first = runRobotCycle(createAccount(10_000), [input('EUR/USD', 'buy')], cfg)
    expect(first.state.positions).toHaveLength(1)

    // Second qualifying signal on the same pair while the first is still open.
    const second = runRobotCycle(first.state, [input('EUR/USD', 'buy')], cfg)
    expect(second.state.positions).toHaveLength(2)
    expect(second.state.positions.every((p) => p.symbol === 'EUR/USD')).toBe(true)
  })

  it('skips (never over-fills) a pair already at maxPerPair', () => {
    const cfg = config({ tradeMode: 'concurrent', maxPerPair: 2, maxOpenTrades: 5 })
    let state = createAccount(10_000)
    state = runRobotCycle(state, [input('EUR/USD', 'buy')], cfg).state
    state = runRobotCycle(state, [input('EUR/USD', 'buy')], cfg).state

    const third = runRobotCycle(state, [input('EUR/USD', 'buy')], cfg)
    expect(third.state.positions).toHaveLength(2) // still 2 — no over-fill
    expect(third.events.some((e) => e.includes('per-pair cap 2 reached'))).toBe(true)
  })
})

describe('runRobotCycle — sequential mode', () => {
  it('keeps at most one position per pair (second signal on same pair is skipped)', () => {
    const cfg = config({ tradeMode: 'sequential', maxPerPair: 1 })
    let state = createAccount(10_000)
    state = runRobotCycle(state, [input('EUR/USD', 'buy')], cfg).state
    expect(state.positions).toHaveLength(1)

    const again = runRobotCycle(state, [input('EUR/USD', 'buy')], cfg)
    expect(again.state.positions).toHaveLength(1)
    expect(again.events.some((e) => e.includes('per-pair cap 1 reached'))).toBe(true)
  })
})

describe('runRobotCycle — global maxOpenTrades cap', () => {
  it('defers qualifying pairs once the global cap is reached', () => {
    const cfg = config({ tradeMode: 'concurrent', maxPerPair: 2, maxOpenTrades: 2 })
    const { state, events } = runRobotCycle(
      createAccount(10_000),
      [input('EUR/USD', 'buy'), input('GBP/USD', 'buy'), input('USD/JPY', 'buy')],
      cfg,
    )
    expect(state.positions).toHaveLength(2) // global cap of 2
    expect(events.some((e) => e.includes('global cap 2 reached'))).toBe(true)
  })
})

describe('runRobotCycle — partial pair failure isolation', () => {
  it('continues the cycle when one pair fails (invalid price)', () => {
    const { state, events } = runRobotCycle(
      createAccount(10_000),
      [input('EUR/USD', 'buy', 0), input('GBP/USD', 'buy')], // EUR/USD price invalid
      config(),
    )
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].symbol).toBe('GBP/USD')
    expect(events.some((e) => e.startsWith('EUR/USD:'))).toBe(true)
  })

  it('stands the whole robot down when the daily loss gate trips (account-wide)', () => {
    let state = createAccount(10_000)
    // Force the daily loss limit by opening and closing a losing position first.
    const opened = openPosition(
      state,
      { symbol: 'EUR/USD', side: 'long', entryPrice: RATES['EUR/USD'] ?? 1.085, stopPips: 20, takeProfitPips: 40, units: 10_000, strategy: 'X' },
      RATES,
    )
    state = opened.state
    // Price tanks → realized loss trips the 5% daily loss gate (-$1050 < -$500).
    const { state: closedState } = markToMarket(state, { ...RATES, 'EUR/USD': 0.98 })
    state = closedState
    expect(state.balance).toBeLessThan(10_000)

    const { state: next, events } = runRobotCycle(
      state,
      [input('EUR/USD', 'buy'), input('GBP/USD', 'buy')],
      config(),
    )
    // The gate is account-wide by design: no pair opens until tomorrow, and the
    // cycle reports it instead of failing.
    expect(next.positions).toHaveLength(0)
    expect(events.some((e) => e.includes('Daily loss limit'))).toBe(true)
  })
})