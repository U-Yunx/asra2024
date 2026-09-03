/**
 * Rule-based signal generation for the four strategies. Each strategy compares
 * its latest indicator value(s) to thresholds and returns a directional signal
 * plus a small set of human-readable indicator readings for the UI.
 */
import type { Bar, Signal, StrategyConfig } from '../types'
import { computeIndicators } from './indicators'

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

export function computeSignal(bars: Bar[], config: StrategyConfig): SignalResult {
  const ind = computeIndicators(bars, config)
  const last = bars.length - 1
  const prev = last - 1
  const p = config.params

  switch (config.type) {
    case 'MA': {
      const fCur = ind.fast?.[last]
      const fPrev = ind.fast?.[prev]
      const sCur = ind.slow?.[last]
      const sPrev = ind.slow?.[prev]
      const signal: Signal =
        fCur == null || sCur == null
          ? 'neutral'
          : crossOver(fPrev, fCur, sCur ?? sPrev ?? 0) && fCur > (sCur ?? 0)
            ? 'buy'
            : crossUnder(fPrev, fCur, sCur ?? sPrev ?? 0) && fCur < (sCur ?? 0)
              ? 'sell'
              : 'neutral'
      return {
        signal,
        indicatorValues: [
          { label: 'Fast MA', value: fmt(fCur) },
          { label: 'Slow MA', value: fmt(sCur) },
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
      const signal: Signal =
        hCur == null ? 'neutral' : crossOver(hPrev, hCur, 0) ? 'buy' : crossUnder(hPrev, hCur, 0) ? 'sell' : 'neutral'
      return {
        signal,
        indicatorValues: [{ label: 'MACD hist', value: fmt(hCur, 5) }],
      }
    }
    case 'BOLLINGER': {
      const up = ind.upper?.[last]
      const lo = ind.lower?.[last]
      const mid = ind.middle?.[last]
      const close = bars[last].close
      // Mean-reversion: buy when price pierces below the lower band, sell when
      // it pierces above the upper band.
      const signal: Signal =
        up == null || lo == null ? 'neutral' : close <= lo ? 'buy' : close >= up ? 'sell' : 'neutral'
      return {
        signal,
        indicatorValues: [
          { label: 'Upper', value: fmt(up) },
          { label: 'Middle', value: fmt(mid) },
          { label: 'Lower', value: fmt(lo) },
        ],
      }
    }
  }
}