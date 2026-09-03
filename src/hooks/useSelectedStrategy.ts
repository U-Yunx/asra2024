/**
 * The strategy the trading page is currently configured with (pair, interval,
 * type, params). Persisted to localStorage so the choice survives reloads.
 */
import { useCallback, useEffect, useState } from 'react'
import type { StrategyConfig } from '../lib/types'
import { defaultParams } from '../lib/strategies'

const KEY = 'ana24.selected-strategy'

export const DEFAULT_STRATEGY: StrategyConfig = {
  pair: 'EUR/USD',
  interval: '5min',
  type: 'RSI',
  params: defaultParams('RSI'),
}

function loadStrategy(): StrategyConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_STRATEGY
    const p = JSON.parse(raw) as Partial<StrategyConfig>
    const type = p.type === 'MA' || p.type === 'RSI' || p.type === 'MACD' || p.type === 'BOLLINGER' ? p.type : 'RSI'
    return {
      pair: p.pair && typeof p.pair === 'string' ? p.pair : DEFAULT_STRATEGY.pair,
      interval:
        p.interval === '1min' || p.interval === '5min' || p.interval === '15min' || p.interval === '30min' || p.interval === '1h' || p.interval === '4h' || p.interval === '1day'
          ? p.interval
          : DEFAULT_STRATEGY.interval,
      type,
      params: p.params && typeof p.params === 'object' ? p.params : defaultParams(type),
    }
  } catch {
    return DEFAULT_STRATEGY
  }
}

export function useSelectedStrategy() {
  const [strategy, setStrategy] = useState<StrategyConfig>(loadStrategy)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(strategy))
    } catch {
      /* noop */
    }
  }, [strategy])

  const updateStrategy = useCallback((next: Partial<StrategyConfig>) => {
    setStrategy((prev) => {
      const merged = { ...prev, ...next }
      // Changing the strategy type resets params to the type's defaults.
      if (next.type && next.type !== prev.type) {
        merged.params = defaultParams(next.type)
      }
      return merged
    })
  }, [])

  return [strategy, updateStrategy] as const
}