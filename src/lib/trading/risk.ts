/**
 * Risk math shared by the engine, broker adapters and the UI: pip sizes,
 * stop/target levels, PnL in USD, position sizing and ATR-based stops.
 * Everything is denominated in USD; non-USD quote currencies are converted
 * through the live watchlist rates.
 */
import type { RatesMap, Side } from './types'
import type { Bar } from '../types'

const CRYPTO_RE = /BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC/

/** Minimum pip distance for a quote currency (JPY pairs quote in 0.01s). */
export function pipSize(symbol: string): number {
  if (CRYPTO_RE.test(symbol)) return 1
  if (symbol.endsWith('JPY')) return 0.01
  return 0.0001
}

/** USD value of a one-unit price move on one unit of the base currency. */
function usdPerUnit(symbol: string, rates: RatesMap): number | null {
  const quote = symbol.split('/')[1]
  if (!quote) return null
  if (quote === 'USD') return 1
  if (quote === 'JPY') {
    const r = rates[symbol]
    return r && r > 0 ? 1 / r : null
  }
  if (quote === 'CHF') {
    const r = rates['USD/CHF']
    return r && r > 0 ? 1 / r : null
  }
  if (quote === 'CAD') {
    const r = rates['USD/CAD']
    return r && r > 0 ? 1 / r : null
  }
  // Crosses quoted in a third currency (EUR/GBP → GBP/USD etc).
  const cross = rates[`${quote}/USD`]
  if (cross && cross > 0) return cross
  const inv = rates[`USD/${quote}`]
  if (inv && inv > 0) return 1 / inv
  return null
}

/** USD value of a 1-pip move on one unit (null when a rate is missing). */
export function pipValueUsd(symbol: string, rates: RatesMap): number | null {
  const per = usdPerUnit(symbol, rates)
  if (per == null) return null
  return pipSize(symbol) * per
}

/** Realized/unrealized PnL in USD for a position at a given price. */
export function pnlUsd(
  side: Side,
  entryPrice: number,
  price: number,
  units: number,
  symbol: string,
  rates: RatesMap,
): number {
  const per = usdPerUnit(symbol, rates) ?? 1
  const delta = side === 'long' ? price - entryPrice : entryPrice - price
  return delta * units * per
}

/** Stop-loss and take-profit prices for a position (pips → price levels). */
export function stopTakePrices(
  symbol: string,
  side: Side,
  entryPrice: number,
  stopPips: number,
  takeProfitPips: number,
): { stopPrice: number; takeProfitPrice: number } {
  const pip = pipSize(symbol)
  const dir = side === 'long' ? 1 : -1
  const stopPrice = entryPrice - dir * stopPips * pip
  const takeProfitPrice = entryPrice + dir * takeProfitPips * pip
  return { stopPrice, takeProfitPrice }
}

/** Average true range over the bars, as a stop distance in pips (min 1). */
export function stopDistanceFromAtr(bars: Bar[], symbol: string): number {
  if (bars.length < 3) return 1
  let sum = 0
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]
    const b = bars[i]
    const tr = Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close))
    sum += tr
  }
  const atr = sum / (bars.length - 1)
  const pips = Math.round(atr / pipSize(symbol))
  return Math.max(1, pips)
}

/** Position units that risk `riskPct`% of equity if stopped at `stopPips`. */
export function suggestPositionUnits(input: {
  equity: number
  riskPct: number
  stopPips: number
  pipValue: number
}): number {
  if (input.equity <= 0 || input.stopPips <= 0 || input.pipValue <= 0) return 0
  const riskAmount = (input.equity * input.riskPct) / 100
  return Math.floor(riskAmount / (input.stopPips * input.pipValue))
}