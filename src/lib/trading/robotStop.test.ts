/**
 * Tests for robot-stop behavior: stopping the robot closes only the positions
 * the robot opened (strategy-tagged, e.g. 'MA · 5min'), while manual trades
 * (tagged strategy 'manual') stay open. Also covers the unlimited (0) global
 * open-trade cap.
 */
import { describe, expect, it } from 'vitest'
import { closeRobotPositions, createAccount, openPosition, runRobotCycle } from './engine'
import { DEFAULT_ROBOT_CONFIG } from './types'
import type { RobotConfig } from './types'

const RATES: Record<string, number> = { 'EUR/USD': 1.1, 'GBP/USD': 1.27 }

function openedAccount() {
  let acc = createAccount(10_000)
  // A robot position (strategy-tagged, NOT 'manual').
  acc = openPosition(
    acc,
    { symbol: 'EUR/USD', side: 'long', entryPrice: 1.1, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'MA · 5min' },
    RATES,
  ).state
  // A manual position (strategy 'manual').
  acc = openPosition(
    acc,
    { symbol: 'GBP/USD', side: 'long', entryPrice: 1.27, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'manual' },
    RATES,
  ).state
  return acc
}

describe('closeRobotPositions (robot stop)', () => {
  it('closes only robot-opened positions and leaves manual trades open', () => {
    const acc = openedAccount()
    expect(acc.positions).toHaveLength(2)

    const { state, closed } = closeRobotPositions(acc, RATES)

    expect(closed).toHaveLength(1)
    expect(closed[0].strategy).toBe('MA · 5min')
    expect(closed[0].closeReason).toBe('robot_stop')
    // The manual trade is untouched.
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].strategy).toBe('manual')
    expect(state.positions[0].symbol).toBe('GBP/USD')
  })

  it('closes nothing when there are no robot positions', () => {
    let acc = createAccount(10_000)
    acc = openPosition(
      acc,
      { symbol: 'GBP/USD', side: 'long', entryPrice: 1.27, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'manual' },
      RATES,
    ).state

    const { state, closed } = closeRobotPositions(acc, RATES)
    expect(closed).toHaveLength(0)
    expect(state.positions).toHaveLength(1)
  })

  it('closes all robot positions even when a manual trade is also open', () => {
    let acc = openedAccount()
    acc = openPosition(
      acc,
      { symbol: 'USD/JPY', side: 'short', entryPrice: 150, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'RSI · 5min' },
      { ...RATES, 'USD/JPY': 150 },
    ).state

    const { state, closed } = closeRobotPositions(acc, { ...RATES, 'USD/JPY': 150 })
    expect(closed).toHaveLength(2)
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].strategy).toBe('manual')
  })
})

describe('maxOpenTrades default (0 = unlimited)', () => {
  it('defaults to unlimited (0)', () => {
    expect(DEFAULT_ROBOT_CONFIG.maxOpenTrades).toBe(0)
  })

  it('does not cap positions when maxOpenTrades is 0', () => {
    let acc = createAccount(10_000)
    const config: RobotConfig = { ...DEFAULT_ROBOT_CONFIG, pairs: ['EUR/USD', 'GBP/USD'], tradeMode: 'concurrent', maxPerPair: 2, maxOpenTrades: 0 }
    const inputs = [
      { symbol: 'EUR/USD', signal: 'buy' as const, price: 1.1, rates: RATES, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'MA · 5min' },
      { symbol: 'GBP/USD', signal: 'buy' as const, price: 1.27, rates: RATES, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'MA · 5min' },
    ]
    const { state, events } = runRobotCycle(acc, inputs, config)
    expect(state.positions).toHaveLength(2)
    expect(events.some((e) => e.includes('Deferred'))).toBe(false)
  })

  it('caps positions when maxOpenTrades is positive', () => {
    let acc = createAccount(10_000)
    const config: RobotConfig = { ...DEFAULT_ROBOT_CONFIG, pairs: ['EUR/USD', 'GBP/USD'], tradeMode: 'concurrent', maxPerPair: 2, maxOpenTrades: 1 }
    const inputs = [
      { symbol: 'EUR/USD', signal: 'buy' as const, price: 1.1, rates: RATES, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'MA · 5min' },
      { symbol: 'GBP/USD', signal: 'buy' as const, price: 1.27, rates: RATES, stopPips: 20, takeProfitPips: 40, units: 1000, strategy: 'MA · 5min' },
    ]
    const { state, events } = runRobotCycle(acc, inputs, config)
    expect(state.positions).toHaveLength(1)
    expect(events.some((e) => e.includes('Deferred'))).toBe(true)
  })
})