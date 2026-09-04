/**
 * "Best strategy" picker — evaluates every supported strategy on one symbol's
 * bars and returns the strongest actionable setup (signal + a 0–100 score of
 * how confident the robot can be in it). The multi-pair robot ranks pairs by
 * this score, so it trades the strongest setups first.
 *
 * Since the profitability pass the score blends four factors: momentum on the
 * latest bar, trend alignment (is the signal trading WITH the SMA-20 trend?),
 * RSI conviction for reversal signals, and a volatility penalty (wild, whipsaw
 * markets cap the score no matter how pretty the setup looks).
 */
import type { Bar, Interval, Signal, StrategyType } from '../types'
import { STRATEGY_META, STRATEGY_TYPES } from '../strategies'
import { computeSignal } from '../strategies/signals'
import { atr, rsi, sma } from '../strategies/indicators'

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
  const closes = bars.map((b) => b.close)
  const last = bars.length - 1

  // Market context shared by every strategy's score.
  const atrVal = atr(bars, 14)[last] ?? 0
  const atrPct = closes[last] > 0 ? (atrVal / closes[last]) * 100 : 0
  const rsiVal = rsi(closes, 14)[last]
  const sma20 = sma(closes, 20)[last]
  const trendAlign = sma20 != null ? (closes[last] > sma20 ? 1 : -1) : 0

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
    let score = 45 + momentum * 140

    // Trend alignment: trading WITH the SMA-20 trend adds conviction; against
    // it (fading a trend) subtracts.
    if (trendAlign !== 0) {
      score += (signal === 'buy' ? trendAlign : -trendAlign) * 12
    }

    // RSI position: for reversal signals, deeper oversold/overbought means the
    // reversion has more room to run.
    if (rsiVal != null) {
      score += signal === 'buy' ? Math.max(0, 50 - rsiVal) * 0.5 : Math.max(0, rsiVal - 50) * 0.5
    }

    // Volatility penalty: above ~2% ATR the market gets whipsaw-prone and the
    // setup's edge shrinks, no matter what the indicators say.
    if (atrPct > 2) score -= Math.min(20, (atrPct - 2) * 5)

    const rounded = Math.round(Math.min(99, Math.max(5, score)))
    if (!best || rounded > best.score) {
      best = { type, signal, score: rounded }
    }
  }

  return best
}
