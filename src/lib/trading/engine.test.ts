/**
 * Engine unit tests: account lifecycle, position sizing / stops, SL-TP
 * enforcement, signal application and the multi-pair robot cycle.
 */
import { describe, expect, it } from 'vitest'
import {
  applySignal,
  canOpen,
  closeAllPositions,
  closePosition,
  createAccount,
  equity,
  markToMarket,
  openPosition,
  runRobotCycle,
  todayPnlUsd,
  unrealizedPnl,
} from './engine'
import type { RatesMap } from './types'

// EUR/USD quotes in USD → usdPerUnit = 1; pipSize = 0.0001.
const rates: RatesMap = { 'EUR/USD': 1.1, 'GBP/USD': 1.27 }

describe('createAccount', () => {
  it('starts with the given balance and no positions', () => {
    const acc = createAccount(10_000)
    expect(acc.balance).toBe(10_000)
    expect(acc.positions).toHaveLength(0)
    expect(acc.trades).toHaveLength(0)
    expect(acc.risk.maxOpenPositions).toBeGreaterThan(0)
  })
})

describe('equity', () => {
  it('equals balance when nothing is open', () => {
    const acc = createAccount(10_000)
    expect(equity(acc, rates)).toBe(10_000)
  })

  it('adds unrealized PnL on open positions', () => {
    const acc = createAccount(10_000)
    const { state } = openPosition(acc, {
      symbol: 'EUR/USD',
      side: 'long',
      entryPrice: 1.1,
      stopPips: 20,
      takeProfitPips: 40,
      units: 1000,
      strategy: 'manual',
    }, rates)
    // Price at 1.105 → +0.005 * 1000 units * 1 usd/unit = +5
    const eq = equity(state, { ...rates, 'EUR/USD': 1.105 })
    expect(eq).toBeCloseTo(10_005, 6)
    expect(unrealizedPnl(state, { ...rates, 'EUR/USD': 1.105 })).toBeCloseTo(5, 6)
  })
})

describe('openPosition', () => {
  it('opens a long with pip-based stop and target', () => {
    const acc = createAccount(10_000)
    const { state, error } = openPosition(acc, {
      symbol: 'EUR/USD',
      side: 'long',
      entryPrice: 1.1,
      stopPips: 20,
      takeProfitPips: 40,
      units: 1000,
      strategy: 'manual',
    }, rates)
    expect(error).toBeNull()
    expect(state.positions).toHaveLength(1)
    const p = state.positions[0]
    expect(p.side).toBe('long')
    expect(p.stopPrice).toBeCloseTo(1.098, 6)
    expect(p.takeProfitPrice).toBeCloseTo(1.104, 6)
  })

  it('rejects positions without a stop loss', () => {
    const acc = createAccount(10_000)
    const { error } = openPosition(acc, {
      symbol: 'EUR/USD',
      side: 'long',
      entryPrice: 1.1,
      stopPips: 0,
      takeProfitPips: 40,
      units: 1000,
    }, rates)
    expect(error).toMatch(/stop loss/i)
  })

  it('enforces a one-position-per-pair cap by default', () => {
    const acc = createAccount(10_000)
    const first = openPosition(acc, {
      symbol: 'EUR/USD', side: 'long', entryPrice: 1.1, stopPips: 20, takeProfitPips: 40, units: 1000,
    }, rates)
    expect(first.error).toBeNull()
    const second = openPosition(first.state, {
      symbol: 'EUR/USD', side: 'short', entryPrice: 1.1, stopPips: 20, takeProfitPips: 40, units: 1000,
    }, rates)
    expect(second.error).toMatch(/already open/i)
  })
})

describe('closePosition', () => {
  it('realizes PnL into the balance and journals the trade', () => {
    const acc = createAccount(10_000)
    const { state: opened } = openPosition(acc, {
      symbol: 'EUR/USD', side: 'long', entryPrice: 1.1, stopPips: 20, takeProfitPips: 40, units: 1000,
    }, rates)
    const pos = opened.positions[0]
    const { state, trade } = closePosition(opened, pos.id, {
      price: 1.104,
      reason: 'take_profit',
      rates,
    })
    expect(trade).not.toBeNull()
    expect(trade?.pnl).toBeCloseTo(4, 6)
    expect(state.balance).toBeCloseTo(10_004, 6)
    expect(state.positions).toHaveLength(0)
    expect(state.trades).toHaveLength(1)
  })
})

describe('markToMarket', () => {
  it('closes a long when the stop is hit', () => {
    const acc = createAccount(10_000)
    const { state: opened } = openPosition(acc, {
      symbol: 'EUR/USD', side: 'long', entryPrice: 1.1, stopPips: 20, takeProfitPips: 40, units: 1000,
    }, rates)
    const { closed } = markToMarket(opened, { ...rates, 'EUR/USD': 1.097 })
    expect(closed).toHaveLength(1)
    expect(closed[0].closeReason).toBe('stop_loss')
  })

  it('closes a short when the target is hit', () => {
    const acc = createAccount(10_000)
    const { state: opened } = openPosition(acc, {
      symbol: 'EUR/USD', side: 'short', entryPrice: 1.1, stopPips: 20, takeProfitPips: 40, units: 1000,
    }, rates)
    const { closed } = markToMarket(opened, { ...rates, 'EUR/USD': 1.096 })
    expect(closed).toHaveLength(1)
    expect(closed[0].closeReason).toBe('take_profit')
  })
})

describe('applySignal', () => {
  it('opens a long on a buy signal and flips on a sell', () => {
    let acc = createAccount(10_000)
    const buy = applySignal(acc, {
      symbol: 'EUR/USD', signal: 'buy', price: 1.1, rates,
      strategy: 'RSI', stopPips: 20, takeProfitPips: 40, units: 1000,
    })
    expect(buy.state.positions).toHaveLength(1)
    expect(buy.state.positions[0].side).toBe('long')

    const flip = applySignal(buy.state, {
      symbol: 'EUR/USD', signal: 'sell', price: 1.1, rates,
      strategy: 'RSI', stopPips: 20, takeProfitPips: 40, units: 1000,
    })
    expect(flip.state.positions).toHaveLength(1)
    expect(flip.state.positions[0].side).toBe('short')
  })

  it('ignores neutral signals', () => {
    const acc = createAccount(10_000)
    const res = applySignal(acc, {
      symbol: 'EUR/USD', signal: 'neutral', price: 1.1, rates,
      strategy: 'RSI', stopPips: 20, takeProfitPips: 40, units: 1000,
    })
    expect(res.state.positions).toHaveLength(0)
    expect(res.events).toHaveLength(0)
  })
})

describe('canOpen / daily loss limit', () => {
  it('blocks new entries once the daily loss limit is reached', () => {
    const acc = createAccount(10_000)
    // Force a losing day: initialBalance 10k, 5% limit → -500 blocks.
    const loser = {
      ...acc,
      balance: 9_400,
      trades: [
        {
          id: 't1',
          symbol: 'EUR/USD',
          side: 'long' as const,
          units: 10_000,
          entryPrice: 1.1,
          entryTime: new Date().toISOString(),
          exitPrice: 1.08,
          exitTime: new Date().toISOString(),
          stopPrice: 1.098,
          takeProfitPrice: 1.12,
          entryEquity: 10_000,
          pnl: -600,
          pnlPct: -6,
          closeReason: 'stop_loss' as const,
          strategy: 'manual',
          status: 'closed' as const,
        },
      ],
    }
    expect(todayPnlUsd(loser, rates)).toBeLessThan(-500)
    expect(canOpen(loser, rates).ok).toBe(false)
  })

  it('allows entries when under the limit', () => {
    const acc = createAccount(10_000)
    expect(canOpen(acc, rates).ok).toBe(true)
  })
})

describe('closeAllPositions', () => {
  it('flattens every open position at the current price', () => {
    const acc = createAccount(10_000)
    const first = openPosition(acc, {
      symbol: 'EUR/USD', side: 'long', entryPrice: 1.1, stopPips: 20, takeProfitPips: 40, units: 1000,
    }, rates)
    const second = openPosition(first.state, {
      symbol: 'GBP/USD', side: 'short', entryPrice: 1.27, stopPips: 20, takeProfitPips: 40, units: 1000,
    }, rates)
    const { state, closed } = closeAllPositions(second.state, rates)
    expect(closed).toHaveLength(2)
    expect(state.positions).toHaveLength(0)
  })
})

describe('runRobotCycle', () => {
  it('opens qualifying pairs and skips neutral signals', () => {
    const acc = createAccount(10_000)
    const { state, events } = runRobotCycle(acc, [
      {
        symbol: 'EUR/USD', signal: 'buy', price: 1.1, rates,
        strategy: 'MA', stopPips: 20, takeProfitPips: 40, units: 1000,
      },
      {
        symbol: 'GBP/USD', signal: 'neutral', price: 1.27, rates,
        strategy: 'MA', stopPips: 20, takeProfitPips: 40, units: 1000,
      },
    ], { pairs: ['EUR/USD', 'GBP/USD'], tradeMode: 'sequential', maxPerPair: 1, maxOpenTrades: 0 })
    expect(state.positions).toHaveLength(1)
    expect(events.some((e) => e.includes('Opened EUR/USD'))).toBe(true)
  })

  it('respects the global max-open-trades cap', () => {
    const acc = createAccount(10_000)
    const { state, events } = runRobotCycle(acc, [
      {
        symbol: 'EUR/USD', signal: 'buy', price: 1.1, rates,
        strategy: 'MA', stopPips: 20, takeProfitPips: 40, units: 1000,
      },
      {
        symbol: 'GBP/USD', signal: 'buy', price: 1.27, rates,
        strategy: 'MA', stopPips: 20, takeProfitPips: 40, units: 1000,
      },
    ], { pairs: ['EUR/USD', 'GBP/USD'], tradeMode: 'sequential', maxPerPair: 1, maxOpenTrades: 1 })
    expect(state.positions).toHaveLength(1)
    expect(events.some((e) => e.includes('Deferred GBP/USD'))).toBe(true)
  })
})
