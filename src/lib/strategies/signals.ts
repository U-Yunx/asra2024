/**
 * Rule-based signal generation for the four strategies. Each strategy compares
 * its latest indicator value(s) to thresholds and returns a directional signal
 * plus a small set of human-readable indicator readings for the UI.
 *
 * Every signal passes a quality filter so the robot only trades the setups
 * with real edge:
 *  - MA crosses must clear the ATR noise floor (no whipsaw in quiet markets).
 *  - MACD crosses need real momentum (histogram ≥ 0.02% of price).
 *  - Bollinger pierces are only faded when RSI agrees there is room to revert.
 */
import type { Bar, Signal, StrategyConfig } from '../types'
import { atr, computeIndicators, rsi } from './indicators'

export interface SignalResult {
  signal: Signal
  indicatorValues: { label: string; value: string }[]
}

function fmt(n: number | null | undefined, dp = 4): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toFixed(dp)
}

function crossOver(prev: number | null | undefined, cur: number | null | undefined, line: number): boolean {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return false
  return prev <= line && cur > line
}

function crossUnder(prev: number | null | undefined, cur: number | null | undefined, line: number): boolean {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return false
  return prev >= line && cur < line
}

/**
 * A cross only counts when it clears the market's noise floor (a fraction of
 * the current ATR). `atrVal <= 0` — not enough bars for ATR yet — falls back
 * to a pure cross so early signals still work.
 */
function clearsNoise(delta: number, atrVal: number, factor: number): boolean {
  if (!Number.isFinite(delta)) return false
  if (atrVal <= 0) return true
  return Math.abs(delta) >= factor * atrVal
}

export function computeSignal(bars: Bar[], config: StrategyConfig): SignalResult {
  const ind = computeIndicators(bars, config)
  const last = bars.length - 1
  const prev = last - 1
  const p = config.params

  // Volatility + momentum context shared by the quality filters.
  const atrVal = atr(bars, 14)[last] ?? 0
  const close = bars[last]?.close ?? 0
  const rsiCur = rsi(bars.map((b) => b.close), 14)[last]

  switch (config.type) {
    case 'MA': {
      const fCur = ind.fast?.[last]
      const fPrev = ind.fast?.[prev]
      const sCur = ind.slow?.[last]
      const spread = (fCur ?? 0) - (sCur ?? 0)
      const over =
        fCur != null && sCur != null && crossOver(fPrev, fCur, sCur) && fCur > sCur && clearsNoise(spread, atrVal, 0.25)
      const under =
        fCur != null &&
        sCur != null &&
        crossUnder(fPrev, fCur, sCur) &&
        fCur < sCur &&
        clearsNoise(spread, atrVal, 0.25)
      const signal: Signal = over ? 'buy' : under ? 'sell' : 'neutral'
      return {
        signal,
        indicatorValues: [
          { label: 'Fast MA', value: fmt(fCur) },
          { label: 'Slow MA', value: fmt(sCur) },
          { label: 'ATR', value: fmt(atrVal) },
        ],
      }
    }
    case 'RSI': {
      const rCur = ind.rsi?.[last]
      const rPrev = ind.rsi?.[prev]
      const oversold = p.oversold ?? 30
      const overbought = p.overbought ?? 70
      const signal: Signal =
        rCur == null
          ? 'neutral'
          : crossOver(rPrev, rCur, oversold) && rCur < (overbought + oversold) / 2
            ? 'buy'
            : crossUnder(rPrev, rCur, overbought) && rCur > (overbought + oversold) / 2
              ? 'sell'
              : 'neutral'
      return {
        signal,
        indicatorValues: [
          { label: 'RSI', value: rCur == null ? '—' : rCur.toFixed(1) },
          { label: 'Oversold', value: String(oversold) },
          { label: 'Overbought', value: String(overbought) },
        ],
      }
    }
    case 'MACD': {
      const hCur = ind.histogram?.[last]
      const hPrev = ind.histogram?.[prev]
      // Momentum must be real, not a rounding-level blip: the histogram has to
      // clear 0.02% of price on the cross.
      const minHist = close * 0.0002
      const signal: Signal =
        hCur == null
          ? 'neutral'
          : crossOver(hPrev, hCur, 0) && Math.abs(hCur) >= minHist
            ? 'buy'
            : crossUnder(hPrev, hCur, 0) && Math.abs(hCur) >= minHist
              ? 'sell'
              : 'neutral'
      return {
        signal,
        indicatorValues: [{ label: 'MACD hist', value: fmt(hCur, 5) }],
      }
    }
    case 'BOLLINGER': {
      const up = ind.upper?.[last]
      const lo = ind.lower?.[last]
      const mid = ind.middle?.[last]
      const c = bars[last].close
      // Mean-reversion with confirmation: only fade the band pierce when RSI
      // still points the right way (below mid for buys, above for sells) —
      // this skips early-into-trend pierces that keep running.
      const signal: Signal =
        up == null || lo == null
          ? 'neutral'
          : c <= lo && (rsiCur == null || rsiCur < 50)
            ? 'buy'
            : c >= up && (rsiCur == null || rsiCur > 50)
              ? 'sell'
              : 'neutral'
      return {
        signal,
        indicatorValues: [
          { label: 'Upper', value: fmt(up) },
          { label: 'Middle', value: fmt(mid) },
          { label: 'Lower', value: fmt(lo) },
          { label: 'RSI', value: rsiCur == null ? '—' : rsiCur.toFixed(1) },
        ],
      }
    }
  }
}
