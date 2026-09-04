/**
 * Pure trading-engine reducer. Given an account state and an input it returns a
 * new state — no I/O, no side effects — so the paper robot and any future
 * broker share exactly the same, testable rules.
 */
import type {
  AccountState,
  ApplySignalInput,
  ClosedTrade,
  CloseReason,
  OpenPositionRequest,
  RatesMap,
  RobotConfig,
  RobotCycleInput,
  Side,
} from './types'
import { DEFAULT_RISK } from './types'
import { consecutiveLosses, pnlUsd, pipSize, stopTakePrices } from './risk'

export function createAccount(initialBalance: number, id: string | null = null): AccountState {
  return {
    id,
    broker: 'paper',
    currency: 'USD',
    initialBalance,
    balance: initialBalance,
    risk: { ...DEFAULT_RISK },
    positions: [],
    trades: [],
    createdAt: null,
    updatedAt: null,
  }
}

/** Total equity = balance + unrealized PnL on open positions. */
export function equity(state: AccountState, rates: RatesMap): number {
  return state.balance + unrealizedPnl(state, rates)
}

export function unrealizedPnl(state: AccountState, rates: RatesMap): number {
  let total = 0
  for (const p of state.positions) {
    const cur = rates[p.symbol]
    if (cur != null) total += pnlUsd(p.side, p.entryPrice, cur, p.units, p.symbol, rates)
  }
  return total
}

export function openPosition(
  state: AccountState,
  input: OpenPositionRequest,
  rates: RatesMap,
  opts: { maxPerPair?: number } = {},
): { state: AccountState; error: string | null } {
  const risk = state.risk
  const maxPerPair = opts.maxPerPair ?? 1
  if (!input.entryPrice || input.entryPrice <= 0) return { state, error: 'No valid price to open at.' }
  if (input.units <= 0) return { state, error: 'Position size is too small to trade.' }
  if (input.stopPips <= 0) return { state, error: 'A stop loss is required on every position.' }
  // Per-pair cap: sequential defaults to 1 open per pair; concurrent allows N.
  const onSymbol = state.positions.filter((p) => p.symbol === input.symbol).length
  if (onSymbol >= maxPerPair) {
    return {
      state,
      error:
        maxPerPair === 1
          ? `A ${input.symbol} position is already open.`
          : `Max ${maxPerPair} ${input.symbol} positions already open.`,
    }
  }
  if (state.positions.length >= risk.maxOpenPositions) {
    return { state, error: `Max ${risk.maxOpenPositions} open positions reached.` }
  }
  const gate = canOpen(state, rates)
  if (!gate.ok) return { state, error: gate.reason ?? 'Risk limits block this trade.' }

  const now = input.time ?? new Date().toISOString()
  const { stopPrice, takeProfitPrice } = stopTakePrices(
    input.symbol,
    input.side,
    input.entryPrice,
    input.stopPips,
    Math.max(0, input.takeProfitPips),
  )

  const position = {
    id: crypto.randomUUID(),
    symbol: input.symbol,
    side: input.side,
    units: input.units,
    entryPrice: input.entryPrice,
    entryTime: now,
    stopPrice,
    takeProfitPrice,
    entryEquity: equity(state, rates),
    strategy: input.strategy,
    status: 'open' as const,
  }

  return { state: { ...state, positions: [...state.positions, position], updatedAt: now }, error: null }
}

export function closePosition(
  state: AccountState,
  positionId: string,
  opts: { price: number; reason: CloseReason; rates: RatesMap; time?: string },
): { state: AccountState; trade: ClosedTrade | null } {
  const pos = state.positions.find((p) => p.id === positionId)
  if (!pos) return { state, trade: null }
  const now = opts.time ?? new Date().toISOString()
  const pnl = pnlUsd(pos.side, pos.entryPrice, opts.price, pos.units, pos.symbol, opts.rates)
  const pnlPct = pos.entryEquity > 0 ? (pnl / pos.entryEquity) * 100 : 0
  const trade: ClosedTrade = {
    id: pos.id,
    symbol: pos.symbol,
    side: pos.side,
    units: pos.units,
    entryPrice: pos.entryPrice,
    entryTime: pos.entryTime,
    exitPrice: opts.price,
    exitTime: now,
    stopPrice: pos.stopPrice,
    takeProfitPrice: pos.takeProfitPrice,
    entryEquity: pos.entryEquity,
    pnl,
    pnlPct,
    closeReason: opts.reason,
    strategy: pos.strategy,
    status: 'closed',
  }
  return {
    state: {
      ...state,
      balance: state.balance + pnl,
      positions: state.positions.filter((p) => p.id !== positionId),
      trades: [trade, ...state.trades],
      updatedAt: now,
    },
    trade,
  }
}

/** Check SL/TP against the latest rates and close anything that was hit. */
export function markToMarket(
  state: AccountState,
  rates: RatesMap,
): { state: AccountState; closed: ClosedTrade[] } {
  let next = state
  const closed: ClosedTrade[] = []
  // Ratchet trailing stops first so a profit-protecting stop can trigger below.
  if (state.risk.trailingStop && state.risk.trailPips > 0) {
    next = trailStops(next, rates)
  }
  for (const p of next.positions) {
    const cur = rates[p.symbol]
    if (cur == null) continue
    let reason: CloseReason | null = null
    if (p.side === 'long') {
      if (cur <= p.stopPrice) reason = 'stop_loss'
      else if (cur >= p.takeProfitPrice) reason = 'take_profit'
    } else {
      if (cur >= p.stopPrice) reason = 'stop_loss'
      else if (cur <= p.takeProfitPrice) reason = 'take_profit'
    }
    if (reason) {
      const res = closePosition(next, p.id, { price: cur, reason, rates })
      if (res.trade) closed.push(res.trade)
      next = res.state
    }
  }
  return { state: next, closed }
}

/** Move trailing stops toward the best price so profits are locked in. */
function trailStops(state: AccountState, rates: RatesMap): AccountState {
  let positions = state.positions
  for (const p of positions) {
    const cur = rates[p.symbol]
    if (cur == null) continue
    const pipSizeValue = pipSize(p.symbol)
    // Distance the market has already moved in our favour, in pips.
    const profitPips =
      (p.side === 'long' ? cur - p.entryPrice : p.entryPrice - cur) / pipSizeValue

    // Break-even protection: once the trade is in profit by `breakEvenPips`,
    // lift the stop to the entry price so a winner can't turn back into a
    // loser. Only ever tightens, never loosens.
    if (profitPips >= state.risk.breakEvenPips) {
      if (p.side === 'long' && p.stopPrice < p.entryPrice) {
        positions = positions.map((x) => (x.id === p.id ? { ...x, stopPrice: p.entryPrice } : x))
      } else if (p.side === 'short' && p.stopPrice > p.entryPrice) {
        positions = positions.map((x) => (x.id === p.id ? { ...x, stopPrice: p.entryPrice } : x))
      }
    }

    // Trailing stop: only start ratcheting once the trade is meaningfully in
    // profit (`trailActivationPips`). This stops the stop from being dragged
    // up on noise at entry and lets winners run further before locking in.
    if (profitPips >= state.risk.trailActivationPips) {
      const trail = state.risk.trailPips * pipSizeValue
      const newStop = p.side === 'long' ? cur - trail : cur + trail
      const currentStop =
        positions.find((x) => x.id === p.id)?.stopPrice ?? p.stopPrice
      const improved =
        p.side === 'long' ? newStop > currentStop : newStop < currentStop
      if (improved) {
        positions = positions.map((x) =>
          x.id === p.id ? { ...x, stopPrice: newStop } : x,
        )
      }
    }
  }
  return positions === state.positions ? state : { ...state, positions }
}

/** Close every open position at the current market price (emergency stop). */
export function closeAllPositions(
  state: AccountState,
  rates: RatesMap,
): { state: AccountState; closed: ClosedTrade[] } {
  let next = state
  const closed: ClosedTrade[] = []
  for (const p of state.positions) {
    const cur = rates[p.symbol] ?? p.entryPrice
    const res = closePosition(next, p.id, { price: cur, reason: 'risk', rates })
    if (res.trade) closed.push(res.trade)
    next = res.state
  }
  return { state: next, closed }
}

/** Close only the positions the robot opened (strategy-tagged), leaving manual
 * positions untouched. Used when the robot stops — a stopped robot never leaves
 * open trades it started, but manual trades the user placed stay on the book.
 * Manual trades are tagged with strategy 'manual', so they are always excluded. */
export function closeRobotPositions(
  state: AccountState,
  rates: RatesMap,
): { state: AccountState; closed: ClosedTrade[] } {
  let next = state
  const closed: ClosedTrade[] = []
  for (const p of state.positions) {
    if (!p.strategy || p.strategy === 'manual') continue
    const cur = rates[p.symbol] ?? p.entryPrice
    const res = closePosition(next, p.id, { price: cur, reason: 'robot_stop', rates })
    if (res.trade) closed.push(res.trade)
    next = res.state
  }
  return { state: next, closed }
}

/** Realized (today) + unrealized PnL — used by the daily loss limit. */
export function todayPnlUsd(state: AccountState, rates: RatesMap): number {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const startMs = startOfDay.getTime()
  let total = 0
  for (const t of state.trades) {
    if (new Date(t.exitTime).getTime() >= startMs) total += t.pnl
  }
  return total + unrealizedPnl(state, rates)
}

/** Safety gate: block new entries when the daily loss limit is reached. */
export function canOpen(state: AccountState, rates: RatesMap): { ok: boolean; reason?: string } {
  // Consecutive-loss circuit breaker: after N losses in a row the robot stands
  // down until the streak is broken (a win) or the limit is raised. Off by
  // default (maxConsecutiveLosses = 0); presets turn it on.
  const maxLosses = state.risk.maxConsecutiveLosses
  if (maxLosses > 0) {
    const streak = consecutiveLosses(state.trades)
    if (streak >= maxLosses) {
      return {
        ok: false,
        reason: `${streak} losses in a row — the robot is standing down. Raise the consecutive-loss limit or let a win reset the streak.`,
      }
    }
  }
  const limitPct = state.risk.maxDailyLossPct
  if (limitPct > 0) {
    const limitUsd = (state.initialBalance * limitPct) / 100
    if (todayPnlUsd(state, rates) <= -limitUsd) {
      return {
        ok: false,
        reason: `Daily loss limit (${limitPct}%) reached — the robot is standing down until tomorrow.`,
      }
    }
  }
  return { ok: true }
}

/**
 * Act on a strategy signal: open when a new buy/sell appears, flip on a
 * reversal, and hold through neutral stretches (exits are handled by SL/TP and
 * reversals). This is the "enhancement robot" behaviour.
 */
export function applySignal(
  state: AccountState,
  input: ApplySignalInput,
): { state: AccountState; events: string[] } {
  const { symbol, signal, price, rates, strategy, stopPips, takeProfitPips, units } = input
  if (signal === 'neutral') return { state, events: [] }

  let next = state
  const events: string[] = []
  const side: Side = signal === 'buy' ? 'long' : 'short'
  const pos = next.positions.find((p) => p.symbol === symbol)

  if (pos) {
    if (pos.side === side) return { state: next, events: [] } // already on the right side
    const res = closePosition(next, pos.id, { price, reason: 'signal', rates })
    next = res.state
    events.push(`Closed ${symbol} ${pos.side} on reversal (${price.toFixed(5)}).`)
  }

  const gate = canOpen(next, rates)
  if (!gate.ok) return { state: next, events: [...events, gate.reason ?? 'Risk limit.'] }

  const res = openPosition(
    next,
    { symbol, side, entryPrice: price, stopPips, takeProfitPips, units, strategy },
    rates,
  )
  if (res.error) return { state: next, events: [...events, `${symbol}: ${res.error}`] }
  next = res.state
  events.push(`Opened ${symbol} ${side} at ${price.toFixed(5)}.`)
  return { state: next, events }
}


/**
 * Run one multi-pair robot cycle: evaluate every pair on the watchlist and
 * open a trade on each qualifying pair, subject to the per-pair cap
 * (sequential = 1, concurrent = maxPerPair) and the global maxOpenTrades cap.
 * A pair at either cap is skipped — never over-filled. Per-pair failures
 * (risk gate, position sizing, open error) are isolated: the cycle keeps going
 * for the other pairs. Pure reducer — no I/O — so paper and live share it.
 */
export function runRobotCycle(
  state: AccountState,
  inputs: RobotCycleInput[],
  config: RobotConfig,
): { state: AccountState; events: string[] } {
  let next = state
  const events: string[] = []

  for (const input of inputs) {
    const { symbol, signal, price, rates, strategy, stopPips, takeProfitPips, units } = input
    if (signal === 'neutral') continue

    const side: Side = signal === 'buy' ? 'long' : 'short'
    const openOnSymbol = next.positions.filter((p) => p.symbol === symbol).length
    const perPairCap = config.tradeMode === 'concurrent' ? config.maxPerPair : 1

    // Per-pair cap — a pair at its cap is skipped, never over-filled.
    if (openOnSymbol >= perPairCap) {
      events.push(`Skipped ${symbol}: ${openOnSymbol} open, per-pair cap ${perPairCap} reached.`)
      continue
    }
    // Global cap — remaining qualifying pairs are deferred to the next cycle.
    if (config.maxOpenTrades > 0 && next.positions.length >= config.maxOpenTrades) {
      events.push(`Deferred ${symbol}: global cap ${config.maxOpenTrades} reached.`)
      continue
    }

    const gate = canOpen(next, rates)
    if (!gate.ok) {
      events.push(gate.reason ?? `${symbol}: risk limits block this trade.`)
      continue
    }

    const res = openPosition(
      next,
      { symbol, side, entryPrice: price, stopPips, takeProfitPips, units, strategy },
      rates,
      { maxPerPair: perPairCap },
    )
    if (res.error) {
      events.push(`${symbol}: ${res.error}`)
      continue // isolate this pair — the rest of the cycle proceeds
    }
    next = res.state
    events.push(`Opened ${symbol} ${side} at ${price.toFixed(5)}.`)
  }

  return { state: next, events }
}