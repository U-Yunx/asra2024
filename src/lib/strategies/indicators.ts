/**
 * Pure technical-indicator math. Every function takes an OHLC bar array and
 * returns a series aligned with the input (leading positions are null until the
 * indicator has enough data). Strategy configs choose which series to compute.
 */
import type { Bar, StrategyConfig } from '../types'

export interface IndicatorSeries {
  /** MA fast line (MA strategy). */
  fast?: (number | null)[]
  /** MA slow line (MA strategy). */
  slow?: (number | null)[]
  /** RSI (RSI strategy). */
  rsi?: (number | null)[]
  /** MACD histogram = macd − signal (MACD strategy). */
  histogram?: (number | null)[]
  /** Bollinger upper band (BOLLINGER strategy). */
  upper?: (number | null)[]
  /** Bollinger lower band (BOLLINGER strategy). */
  lower?: (number | null)[]
  /** Bollinger middle band = SMA. */
  middle?: (number | null)[]
}

/** Simple moving average over the last `period` closes. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i >= period - 1 ? sum / period : null)
  }
  return out
}

/** Exponential moving average. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  const k = 2 / (period + 1)
  let prev: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (prev == null) {
      // Seed with the SMA of the first `period` values.
      if (i < period - 1) {
        out.push(null)
        continue
      }
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += values[j]
      prev = sum / period
    } else {
      prev = values[i] * k + prev * (1 - k)
    }
    out.push(prev)
  }
  return out
}

/**
 * Relative Strength Index (Wilder's smoothing). Returns a full-length array
 * aligned with the input — leading positions are null until the indicator has
 * `period` changes to work with.
 */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period + 1) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1]
    if (change >= 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

/** MACD histogram (macd − signal line). */
export function macdHistogram(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): (number | null)[] {
  const fast = ema(values, fastPeriod)
  const slow = ema(values, slowPeriod)
  const macd = values.map((_, i) => {
    if (fast[i] == null || slow[i] == null) return null
    return fast[i]! - slow[i]!
  })
  const macdSeries = macd.filter((v): v is number => v != null)
  const signalOffset = macd.length - macdSeries.length
  const signalSeries = ema(macdSeries, signalPeriod)
  return macd.map((v, i) => {
    if (v == null) return null
    const sig = signalSeries[i - signalOffset]
    if (sig == null) return null
    return v - sig
  })
}

/** Bollinger Bands (SMA ± stdDev × σ). */
export function bollinger(
  values: number[],
  period = 20,
  stdDev = 2,
): { upper: (number | null)[]; lower: (number | null)[]; middle: (number | null)[] } {
  const middle = sma(values, period)
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    const m = middle[i]
    if (m == null) {
      upper.push(null)
      lower.push(null)
      continue
    }
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - m) ** 2
    const sd = Math.sqrt(variance / period)
    upper.push(m + stdDev * sd)
    lower.push(m - stdDev * sd)
  }
  return { upper, lower, middle }
}

const asSeries = (v: (number | null)[]) => v

/** Compute the indicator series selected by a strategy config. */
export function computeIndicators(bars: Bar[], config: StrategyConfig): IndicatorSeries {
  const closes = bars.map((b) => b.close)
  switch (config.type) {
    case 'MA':
      return {
        fast: asSeries(sma(closes, config.params.fastPeriod ?? 10)),
        slow: asSeries(sma(closes, config.params.slowPeriod ?? 30)),
      }
    case 'RSI':
      return {
        rsi: asSeries(rsi(closes, config.params.period ?? 14)),
      }
    case 'MACD':
      return {
        histogram: asSeries(
          macdHistogram(
            closes,
            config.params.fastPeriod ?? 12,
            config.params.slowPeriod ?? 26,
            config.params.signalPeriod ?? 9,
          ),
        ),
      }
    case 'BOLLINGER': {
      const { upper, lower, middle } = bollinger(closes, config.params.period ?? 20, config.params.stdDev ?? 2)
      return { upper, lower, middle }
    }
  }
}