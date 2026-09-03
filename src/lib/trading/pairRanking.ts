/**
 * Multi-pair ranking for the "best analysis method" robot. Given fresh bars for
 * every candidate pair, it evaluates all strategies on each pair (via
 * bestStrategy) and ranks the pairs by probability of profit, so the robot can
 * trade the strongest setups first — one position per pair, capped by the
 * account risk settings.
 */
import type { Bar, Interval } from '../types'
import { bestStrategyFor, type BestStrategy } from './bestStrategy'

export interface RankedPair {
  symbol: string
  /** 0–100 probability-of-profit estimate (higher = stronger setup). */
  score: number
  /** Best actionable setup for the pair, or null when nothing qualifies. */
  best: BestStrategy | null
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
    out.push({ symbol, score: best?.score ?? 0, best })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
