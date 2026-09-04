/**
 * Multi-pair ranking for the "best analysis method" robot. Given fresh bars for
 * every candidate pair, it evaluates all strategies on each pair (via
 * bestStrategy) and ranks the pairs by probability of profit, so the robot can
 * trade the strongest setups first — one position per pair, capped by the
 * account risk settings.
 *
 * Ties are broken toward the calmer pair: among two setups with equal scores,
 * the one with lower recent volatility (ATR as a % of price) ranks first,
 * because its stop-loss is easier to protect.
 */
import type { Bar, Interval } from '../types'
import { bestStrategyFor, type BestStrategy } from './bestStrategy'
import { atr } from '../strategies/indicators'

export interface RankedPair {
  symbol: string
  /** 0–100 probability-of-profit estimate (higher = stronger setup). */
  score: number
  /** Best actionable setup for the pair, or null when nothing qualifies. */
  best: BestStrategy | null
  /** Recent volatility (ATR14 as % of price) — used to break score ties. */
  volatilityPct?: number
}

/** ATR(14) as a % of the latest close; Infinity when not computable yet. */
function recentVolatilityPct(bars: Bar[]): number {
  if (bars.length < 15) return Number.POSITIVE_INFINITY
  const last = bars[bars.length - 1]
  const atrVal = atr(bars, 14)[bars.length - 1]
  if (atrVal == null || atrVal <= 0 || !(last.close > 0)) return Number.POSITIVE_INFINITY
  return (atrVal / last.close) * 100
}

/**
 * Rank every symbol that has bars by its best strategy's score, strongest
 * first. Pairs with no actionable setup still appear (score 0, best null) so
 * the caller can decide whether to skip or surface them.
 */
export function rankPairs(barsBySymbol: Record<string, Bar[]>, interval: Interval): RankedPair[] {
  const out: RankedPair[] = []
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!Array.isArray(bars) || bars.length === 0) continue
    const best = bestStrategyFor(bars, interval)
    out.push({ symbol, score: best?.score ?? 0, best, volatilityPct: recentVolatilityPct(bars) })
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Equal scores: calmer pair first (lower volatilityPct).
    const va = a.volatilityPct ?? Number.POSITIVE_INFINITY
    const vb = b.volatilityPct ?? Number.POSITIVE_INFINITY
    return va - vb
  })
  return out
}
