/**
 * Performance analytics over a paper/live account's closed trades and positions
 * — used by the Account and Performance pages.
 */
import type { ClosedTrade, Position } from './types'

export interface TradeStats {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  netPnl: number
  grossProfit: number
  grossLoss: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  bestTrade: number
  worstTrade: number
  avgHoldMs: number | null
}

export function computeTradeStats(trades: ClosedTrade[]): TradeStats {
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const netPnl = grossProfit - grossLoss
  const holds = trades.filter((t) => t.exitTime && t.entryTime)
  const totalHoldMs = holds.reduce(
    (s, t) => s + (new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()),
    0,
  )
  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    bestTrade: trades.length > 0 ? Math.max(...trades.map((t) => t.pnl)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map((t) => t.pnl)) : 0,
    avgHoldMs: holds.length > 0 ? totalHoldMs / holds.length : null,
  }
}

export interface EquitySnapshot {
  time: string
  equity: number
  balance: number
}

/** Equity curve from closed trades (points at each trade close). */
export function equityCurveFromTrades(
  trades: ClosedTrade[],
  initialBalance: number,
): EquitySnapshot[] {
  const sorted = [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))
  const out: EquitySnapshot[] = [{ time: sorted[0]?.entryTime ?? new Date().toISOString(), equity: initialBalance, balance: initialBalance }]
  let equity = initialBalance
  for (const t of sorted) {
    equity += t.pnl
    out.push({ time: t.exitTime, equity, balance: equity })
  }
  return out
}

/** Projected current equity from a live account (balance + unrealized). */
export function liveEquity(
  account: { balance: number; positions: Position[]; initialBalance: number },
  unrealizedPnl: number,
): { balance: number; equity: number; unrealized: number; returnPct: number } {
  const equity = account.balance + unrealizedPnl
  return {
    balance: account.balance,
    equity,
    unrealized: unrealizedPnl,
    returnPct: account.initialBalance > 0 ? ((equity - account.initialBalance) / account.initialBalance) * 100 : 0,
  }
}