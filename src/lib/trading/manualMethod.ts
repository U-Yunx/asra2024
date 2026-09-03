/**
 * Manual trading-method ranking for the robot. When the user chooses a single
 * strategy ("manual method"), the robot still scores every candidate pair by
 * that strategy's live signal so it trades the strongest setups first — same
 * probability-of-profit estimate the auto mode uses, so sizing, stops and the
 * per-pair caps stay identical.
 */
import type { Bar, Interval, StrategyType } from '../types'
import { computeSignal } from '../strategies/signals'
import { bestStrategyFor, type BestStrategy } from './bestStrategy'
import { defaultParams } from '../strategies'
import type { RankedPair } from './pairRanking'

/**
 * Rank pairs using ONE user-selected strategy. For each pair with enough bars
 * it computes that strategy's live signal and scores it with the same
 * probability-of-profit estimate as auto mode. Pairs with a neutral signal get
 * score 0 / best null and are skipped by the robot.
 */
export function manualTargets(
  barsBySymbol: Record<string, Bar[]>,
  type: StrategyType,
  interval: Interval,
): RankedPair[] {
  const out: RankedPair[] = []
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!Array.isArray(bars) || bars.length < 30) continue
    const { signal } = computeSignal(bars, {
      pair: symbol,
      interval,
      type,
      params: defaultParams(type),
    })
    if (signal === 'neutral') continue
    const best = bestStrategyFor(bars, interval)
    const fallback: BestStrategy = { type, signal, score: 50 }
    out.push({ symbol, score: best?.score ?? 50, best: best ?? fallback })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
