/**
 * Robot trading-style preferences (scalping vs long-term) plus the mapping
 * from a style to sensible interval + risk defaults. Persisted to localStorage.
 */
import { useCallback, useState } from 'react'
import type { Interval, RobotPrefs, TradingMethod } from '../types'
import type { RiskConfig } from './types'

const KEY = 'ana24.robot-prefs'
const DEFAULTS: RobotPrefs = {
  method: 'scalping',
  durationMinutes: null,
  pairs: [],
  autoPickPairs: false,
  pairCount: 5,
  perTradeTakeProfitPips: 0,
  perTradeStopLossPips: 0,
  overallMaxProfitUsd: 0,
  overallMaxLossUsd: 0,
  tradeMode: 'sequential',
  maxPerPair: 1,
  maxOpenTrades: 0,
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function loadRobotPrefs(): RobotPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<RobotPrefs>
    return {
      method: p.method === 'longterm' ? 'longterm' : 'scalping',
      durationMinutes: typeof p.durationMinutes === 'number' ? p.durationMinutes : null,
      pairs: Array.isArray(p.pairs) ? p.pairs : [],
      autoPickPairs: p.autoPickPairs === true,
      pairCount: Math.min(10, Math.max(1, num(p.pairCount, DEFAULTS.pairCount))),
      perTradeTakeProfitPips: Math.max(0, num(p.perTradeTakeProfitPips, 0)),
      perTradeStopLossPips: Math.max(0, num(p.perTradeStopLossPips, 0)),
      overallMaxProfitUsd: Math.max(0, num(p.overallMaxProfitUsd, 0)),
      overallMaxLossUsd: Math.max(0, num(p.overallMaxLossUsd, 0)),
      tradeMode: p.tradeMode === 'concurrent' ? 'concurrent' : 'sequential',
      maxPerPair: Math.max(1, Math.round(num(p.maxPerPair, DEFAULTS.maxPerPair))),
      // 0 = unlimited (no global cap); any positive number is a hard cap.
      maxOpenTrades: Math.max(0, Math.round(num(p.maxOpenTrades, DEFAULTS.maxOpenTrades))),
    }
  } catch {
    return DEFAULTS
  }
}

export function useRobotPrefs() {
  const [prefs, setPrefs] = useState<RobotPrefs>(loadRobotPrefs)
  const update = useCallback((patch: Partial<RobotPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* noop */
      }
      return next
    })
  }, [])
  return {
    prefs,
    setMethod: (m: TradingMethod) => update({ method: m }),
    setDuration: (minutes: number | null) => update({ durationMinutes: minutes }),
    setPairs: (pairs: string[]) => update({ pairs }),
    togglePair: (symbol: string) => update({ pairs: toggleInList(prefs.pairs, symbol) }),
    setAutoPickPairs: (autoPickPairs: boolean) => update({ autoPickPairs }),
    setPairCount: (pairCount: number) => update({ pairCount }),
    setPerTradeTakeProfitPips: (perTradeTakeProfitPips: number) => update({ perTradeTakeProfitPips }),
    setPerTradeStopLossPips: (perTradeStopLossPips: number) => update({ perTradeStopLossPips }),
    setOverallMaxProfitUsd: (overallMaxProfitUsd: number) => update({ overallMaxProfitUsd }),
    setOverallMaxLossUsd: (overallMaxLossUsd: number) => update({ overallMaxLossUsd }),
    setTradeMode: (tradeMode: 'sequential' | 'concurrent') => update({ tradeMode }),
    setMaxPerPair: (maxPerPair: number) => update({ maxPerPair }),
    setMaxOpenTrades: (maxOpenTrades: number) => update({ maxOpenTrades }),
  }
}

/** Add or remove a symbol from a list (used by the multi-pair robot selector). */
function toggleInList(list: string[], symbol: string): string[] {
  return list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol]
}

/** The interval that suits a trading style. */
export function methodInterval(method: TradingMethod): Interval {
  return method === 'longterm' ? '1h' : '5min'
}

/** Risk + stop defaults that suit a trading style. */
export function methodRiskDefaults(method: TradingMethod): Pick<
  RiskConfig,
  'defaultStopPips' | 'takeProfitRatio' | 'riskPerTradePct'
> {
  return method === 'longterm'
    ? { defaultStopPips: 40, takeProfitRatio: 2.5, riskPerTradePct: 1 }
    : { defaultStopPips: 12, takeProfitRatio: 1.8, riskPerTradePct: 0.5 }
}

export function methodLabel(method: TradingMethod): string {
  return method === 'longterm' ? 'Long-term' : 'Scalping'
}