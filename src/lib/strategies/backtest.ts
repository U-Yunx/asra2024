/**
 * Walk-forward backtester. Runs a strategy over historical bars and returns
 * closed trades, an equity curve and summary metrics — used by the Backtester
 * page, the auto-tune optimizer and the pair-ranking engine.
 */
import type {
  BacktestMetrics,
  BacktestResult,
  Bar,
  EquityPoint,
  StrategyConfig,
  Trade,
} from '../types'
import { computeSignal } from './signals'
import type { RobotConfig } from '../trading/types'

export { computeIndicators } from './indicators'

interface OpenTrade {
  side: 'long' | 'short'
  entryTime: string
  entryPrice: number
}

const NO_METRICS: BacktestMetrics = {
  totalReturnPct: 0,
  winRatePct: 0,
  maxDrawdownPct: 0,
  profitFactor: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  netProfit: 0,
}

export type MultiBacktestSettings = Pick<RobotConfig, 'pairs' | 'tradeMode' | 'maxPerPair' | 'maxOpenTrades'>

interface OpenMultiTrade {
  symbol: string
  side: 'long' | 'short'
  entryTime: string
  entryPrice: number
}

/**
 * Multi-pair backtest with shared account equity. All watchlist bars are merged
 * into a single time-ordered event stream so positions across pairs share one
 * equity curve and are subject to the same per-pair cap (sequential = 1,
 * concurrent = maxPerPair) and global max-open-trades cap — mirroring the live
 * engine's `runRobotCycle`. A single-pair watchlist delegates to `runBacktest`
 * so existing results are byte-for-byte identical.
 */
export function runMultiBacktest(
  barsBySymbol: Record<string, Bar[]>,
  config: StrategyConfig,
  settings: MultiBacktestSettings,
  startEquity = 10_000,
): BacktestResult {
  const symbols = settings.pairs.filter((s) => (barsBySymbol[s]?.length ?? 0) >= 2)
  if (symbols.length <= 1) {
    const only = symbols[0] ?? config.pair
    return runBacktest(barsBySymbol[only] ?? [], { ...config, pair: only }, startEquity)
  }

  // One time-ordered event per bar across every symbol.
  interface BarEvent {
    time: string
    symbol: string
    bar: Bar
    idx: number
  }
  const events: BarEvent[] = []
  const lastIdx: Record<string, number> = {}
  for (const sym of symbols) {
    const bars = barsBySymbol[sym] as Bar[]
    lastIdx[sym] = bars.length - 1
    for (let i = 0; i < bars.length; i++) {
      events.push({ time: bars[i].time, symbol: sym, bar: bars[i], idx: i })
    }
  }
  events.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.symbol.localeCompare(b.symbol)))

  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  const perPairCap = settings.tradeMode === 'concurrent' ? settings.maxPerPair : 1
  let equity = startEquity
  let peak = startEquity
  let maxDrawdown = 0
  let wins = 0
  let losses = 0
  let grossProfit = 0
  let grossLoss = 0
  let open: OpenMultiTrade[] = []

  const mark = (time: string) => {
    equityCurve.push({ time, equity: Math.round(equity * 100) / 100 })
    peak = Math.max(peak, equity)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100)
  }

  for (const ev of events) {
    const { symbol, bar, idx } = ev
    const bars = barsBySymbol[symbol] as Bar[]
    const { signal } = computeSignal(bars.slice(0, idx + 1), { ...config, pair: symbol })
    const mine = open.filter((o) => o.symbol === symbol)
    const flip =
      mine.some((o) => o.side === 'long' && signal === 'sell') ||
      mine.some((o) => o.side === 'short' && signal === 'buy')
    const endOfData = idx === lastIdx[symbol]

    // Close this symbol's positions on a flip or the end of its data.
    if ((flip || endOfData) && mine.length > 0) {
      for (const o of mine) {
        const pnlPts = o.side === 'long' ? bar.close - o.entryPrice : o.entryPrice - bar.close
        const pnlPct = (pnlPts / o.entryPrice) * 100
        const pnl = (equity * pnlPct) / 100
        equity += pnl
        trades.push({
          side: o.side,
          symbol,
          entryTime: o.entryTime,
          entryPrice: o.entryPrice,
          exitTime: bar.time,
          exitPrice: bar.close,
          pnl: pnlPts,
          pnlPct,
          reason: flip ? 'signal' : 'end',
          open: false,
        })
        if (pnl >= 0) {
          wins++
          grossProfit += pnl
        } else {
          losses++
          grossLoss += -pnl
        }
      }
      open = open.filter((o) => o.symbol !== symbol)
      mark(bar.time)
    }

    // Open when a signal qualifies and both caps have room — never over-fill.
    if ((signal === 'buy' || signal === 'sell') && idx < lastIdx[symbol]) {
      const openForSymbol = open.filter((o) => o.symbol === symbol).length
      const underPerPair = openForSymbol < perPairCap
      const underGlobal = settings.maxOpenTrades <= 0 || open.length < settings.maxOpenTrades
      if (underPerPair && underGlobal) {
        open.push({
          symbol,
          side: signal === 'buy' ? 'long' : 'short',
          entryTime: bar.time,
          entryPrice: bar.close,
        })
      }
    }
  }

  // Close anything still open at the very end of the merged timeline.
  if (open.length > 0) {
    const last = events[events.length - 1]
    for (const o of open) {
      const pnlPts = o.side === 'long' ? last.bar.close - o.entryPrice : o.entryPrice - last.bar.close
      const pnlPct = (pnlPts / o.entryPrice) * 100
      const pnl = (equity * pnlPct) / 100
      equity += pnl
      trades.push({
        side: o.side,
        symbol: o.symbol,
        entryTime: o.entryTime,
        entryPrice: o.entryPrice,
        exitTime: last.time,
        exitPrice: last.bar.close,
        pnl: pnlPts,
        pnlPct,
        reason: 'end',
        open: false,
      })
    }
    mark(last.time)
  }

  const totalTrades = trades.length
  const netProfit = grossProfit - grossLoss
  const totalReturnPct = startEquity > 0 ? (netProfit / startEquity) * 100 : 0
  const metrics: BacktestMetrics = {
    totalReturnPct,
    winRatePct: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    maxDrawdownPct: maxDrawdown,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    totalTrades,
    wins,
    losses,
    netProfit,
  }

  return {
    bars: barsBySymbol[config.pair] ?? events.map((e) => e.bar),
    trades,
    equityCurve,
    metrics,
    strategy: { ...config, pair: symbols[0] ?? config.pair },
    startEquity,
    finalEquity: equity,
  }
}

export function runBacktest(bars: Bar[], config: StrategyConfig, startEquity = 10_000): BacktestResult {
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  if (bars.length < 2) {
    return {
      bars,
      trades,
      equityCurve: [{ time: bars[0]?.time ?? new Date().toISOString(), equity: startEquity }],
      metrics: NO_METRICS,
      strategy: config,
      startEquity,
      finalEquity: startEquity,
    }
  }

  let equity = startEquity
  let open: OpenTrade | null = null
  let peak = startEquity
  let maxDrawdown = 0
  let wins = 0
  let losses = 0
  let grossProfit = 0
  let grossLoss = 0

  // Equity is tracked per closed trade plus a final mark at the last bar.
  const mark = (time: string) => {
    equityCurve.push({ time, equity: Math.round(equity * 100) / 100 })
    peak = Math.max(peak, equity)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100)
  }

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]
    const { signal } = computeSignal(bars.slice(0, i + 1), config)

    if (open) {
      // Exit on a flip or the end of data.
      const flip =
        (open.side === 'long' && signal === 'sell') || (open.side === 'short' && signal === 'buy')
      if (flip || i === bars.length - 1) {
        const exitPrice = bar.close
        const pnlPts = open.side === 'long' ? exitPrice - open.entryPrice : open.entryPrice - exitPrice
        const pnlPct = (pnlPts / open.entryPrice) * 100
        const pnl = (equity * pnlPct) / 100
        equity += pnl
        trades.push({
          side: open.side,
          entryTime: open.entryTime,
          entryPrice: open.entryPrice,
          exitTime: bar.time,
          exitPrice,
          pnl: pnlPts,
          pnlPct,
          reason: flip ? 'signal' : 'end',
          open: false,
        })
        if (pnl >= 0) {
          wins++
          grossProfit += pnl
        } else {
          losses++
          grossLoss += -pnl
        }
        mark(bar.time)
        open = null
      }
    }

    if (!open && (signal === 'buy' || signal === 'sell') && i < bars.length - 1) {
      open = { side: signal === 'buy' ? 'long' : 'short', entryTime: bar.time, entryPrice: bar.close }
    }
  }

  const totalTrades = trades.length
  const netProfit = grossProfit - grossLoss
  const totalReturnPct = startEquity > 0 ? (netProfit / startEquity) * 100 : 0
  const metrics: BacktestMetrics = {
    totalReturnPct,
    winRatePct: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    maxDrawdownPct: maxDrawdown,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    totalTrades,
    wins,
    losses,
    netProfit,
  }

  return {
    bars,
    trades,
    equityCurve,
    metrics,
    strategy: config,
    startEquity,
    finalEquity: equity,
  }
}