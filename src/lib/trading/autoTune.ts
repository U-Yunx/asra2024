/**
 * Auto-tune: grid-search a strategy's parameters against recent bars and return
 * the parameter set with the best profit factor, if any beats the current one.
 */
import type { Bar, StrategyParams, StrategyType, TunedResult } from '../types'
import { defaultParams } from '../strategies'
import { runBacktest } from '../strategies/backtest'

/** Candidate parameter variants to test per strategy type. */
const VARIANTS: Record<StrategyType, StrategyParams[]> = {
  MA: [
    { fastPeriod: 5, slowPeriod: 20 },
    { fastPeriod: 10, slowPeriod: 30 },
    { fastPeriod: 15, slowPeriod: 50 },
    { fastPeriod: 20, slowPeriod: 60 },
  ],
  RSI: [
    { period: 7, oversold: 25, overbought: 75 },
    { period: 14, oversold: 30, overbought: 70 },
    { period: 21, oversold: 35, overbought: 65 },
  ],
  MACD: [
    { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 },
    { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    { fastPeriod: 16, slowPeriod: 35, signalPeriod: 12 },
  ],
  BOLLINGER: [
    { period: 14, stdDev: 1.5 },
    { period: 20, stdDev: 2 },
    { period: 30, stdDev: 2.5 },
  ],
}

export function autoTune(
  bars: Bar[],
  type: StrategyType,
  current: StrategyParams,
): TunedResult | null {
  const base = { pair: 'AUTO', interval: '5min' as const, type }
  const candidates = [current, ...(VARIANTS[type] ?? [])]
  let best: TunedResult | null = null

  for (const params of candidates) {
    const result = runBacktest(bars, { ...base, params })
    const m = result.metrics
    const score = Number.isFinite(m.profitFactor) ? m.profitFactor : 0
    const candidate: TunedResult = {
      params,
      totalReturnPct: m.totalReturnPct,
      winRatePct: m.winRatePct,
      profitFactor: score,
      trades: m.totalTrades,
    }
    if (!best || (candidate.profitFactor > best.profitFactor && candidate.trades > 0)) {
      best = candidate
    }
  }

  // Only adopt a result that actually beat the current parameters.
  const currentResult = runBacktest(bars, { ...base, params: current }).metrics
  const currentScore = Number.isFinite(currentResult.profitFactor) ? currentResult.profitFactor : 0
  if (!best || best.profitFactor <= currentScore || best.trades <= 0) return null
  return best
}

/** Force the best variant regardless of whether it beats the current set. */
export function autoTuneBest(
  bars: Bar[],
  type: StrategyType,
): { params: StrategyParams; profitFactor: number } | null {
  const best = autoTune(bars, type, defaultParams(type))
  if (!best) return null
  return { params: best.params, profitFactor: best.profitFactor }
}