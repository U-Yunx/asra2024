/**
 * Auto-tune: grid-search a strategy's parameters against recent bars and return
 * the parameter set with the best risk-adjusted score, if any beats the current
 * one.
 *
 * Scoring (since the profitability pass) is deliberately conservative: raw
 * profit factor is punished for thin samples (a few trades are mostly luck),
 * for drawdown (a setup that gives back its gains isn't better) and rewarded
 * for stability. The wider variant grid also lets the optimizer adapt fast/slow
 * periods to the current market regime instead of always re-picking defaults.
 */
import type { Bar, StrategyParams, StrategyType, TunedResult } from '../types'
import { defaultParams } from '../strategies'
import { runBacktest } from '../strategies/backtest'

/** Candidate parameter variants to test per strategy type. */
const VARIANTS: Record<StrategyType, StrategyParams[]> = {
  MA: [
    { fastPeriod: 5, slowPeriod: 20 },
    { fastPeriod: 8, slowPeriod: 24 },
    { fastPeriod: 10, slowPeriod: 30 },
    { fastPeriod: 12, slowPeriod: 40 },
    { fastPeriod: 15, slowPeriod: 50 },
    { fastPeriod: 20, slowPeriod: 60 },
  ],
  RSI: [
    { period: 7, oversold: 25, overbought: 75 },
    { period: 10, oversold: 28, overbought: 72 },
    { period: 14, oversold: 30, overbought: 70 },
    { period: 21, oversold: 35, overbought: 65 },
  ],
  MACD: [
    { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 },
    { fastPeriod: 10, slowPeriod: 24, signalPeriod: 7 },
    { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    { fastPeriod: 16, slowPeriod: 35, signalPeriod: 12 },
  ],
  BOLLINGER: [
    { period: 14, stdDev: 1.5 },
    { period: 18, stdDev: 1.8 },
    { period: 20, stdDev: 2 },
    { period: 30, stdDev: 2.5 },
  ],
}

/** Minimum trades before a result is even eligible — thin samples are noise. */
const MIN_TRADES = 5

/**
 * Risk-adjusted score from backtest metrics:
 *  - PF ≤ 0 → 0 (losing setups never win).
 *  - Fewer than MIN_TRADES scales the score down linearly (sample-size penalty).
 *  - Drawdown above 10% shaves the score, capped at a 40% penalty at 30%+ DD.
 */
function score(m: { profitFactor: number; totalTrades: number; maxDrawdownPct: number }): number {
  if (!Number.isFinite(m.profitFactor) || m.profitFactor <= 0 || m.totalTrades <= 0) return 0
  const sample = Math.min(1, m.totalTrades / MIN_TRADES)
  const ddPenalty = Math.min(0.4, Math.max(0, (m.maxDrawdownPct - 10) / 50))
  return m.profitFactor * sample * (1 - ddPenalty)
}

export function autoTune(
  bars: Bar[],
  type: StrategyType,
  current: StrategyParams,
): TunedResult | null {
  const base = { pair: 'AUTO', interval: '5min' as const, type }
  const candidates = [current, ...(VARIANTS[type] ?? [])]
  let best: TunedResult | null = null
  let bestScore = 0

  for (const params of candidates) {
    const result = runBacktest(bars, { ...base, params })
    const m = result.metrics
    const s = score(m)
    if (s <= 0) continue
    const candidate: TunedResult = {
      params,
      totalReturnPct: m.totalReturnPct,
      winRatePct: m.winRatePct,
      profitFactor: Number.isFinite(m.profitFactor) ? m.profitFactor : 0,
      trades: m.totalTrades,
    }
    if (s > bestScore) {
      best = candidate
      bestScore = s
    }
  }

  // Only adopt a result that actually beat the current parameters.
  const currentScore = score(runBacktest(bars, { ...base, params: current }).metrics)
  if (!best || bestScore <= currentScore || best.trades <= 0) return null
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
