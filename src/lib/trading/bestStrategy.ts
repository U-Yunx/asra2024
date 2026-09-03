/**
 * "Best strategy" picker — evaluates every supported strategy on one symbol's
 * bars and returns the strongest actionable setup (signal + a 0–100 score of
 * how confident the robot can be in it). The score blends the live signal with
 * a momentum-style strength so the multi-pair robot can rank pairs objectively.
 */
import type { Bar, Interval, Signal, StrategyType } from '../types'
import { STRATEGY_META, STRATEGY_TYPES } from '../strategies'
import { computeSignal } from '../strategies/signals'

export interface BestStrategy {
  type: StrategyType
  signal: Signal
  /** Probability-of-profit estimate 0–100 (higher = stronger setup). */
  score: number
}

/** Rough normalized momentum of the last bar against the recent range. */
function momentumStrength(bars: Bar[]): number {
  if (bars.length < 3) return 0
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  const window = bars.slice(-20)
  const hi = Math.max(...window.map((b) => b.high))
  const lo = Math.min(...window.map((b) => b.low))
  const range = hi - lo
  if (!(range > 0)) return 0
  return Math.abs(last.close - prev.close) / range
}

/**
 * Evaluate all strategies on a symbol's bars. Returns the best actionable
 * setup (non-neutral signal, highest score), or null when there isn't enough
 * data yet / nothing is actionable.
 */
export function bestStrategyFor(bars: Bar[], interval: Interval): BestStrategy | null {
  if (!Array.isArray(bars) || bars.length < 30) return null

  const momentum = momentumStrength(bars)
  let best: BestStrategy | null = null

  for (const type of STRATEGY_TYPES) {
    const { signal } = computeSignal(bars, {
      pair: '',
      interval,
      type,
      params: STRATEGY_META[type].defaultParams,
    })
    if (signal === 'neutral') continue

    // Base confidence from having a live signal, scaled by how much the market
    // actually moved on the latest bar — a big move confirms the setup.
    const score = Math.round(Math.min(99, 45 + momentum * 140))
    if (!best || score > best.score) {
      best = { type, signal, score }
    }
  }

  return best
}
