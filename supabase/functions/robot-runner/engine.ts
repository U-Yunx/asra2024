/**
 * Deno port of the client's pure trading engine (src/lib/trading/* and
 * src/lib/strategies/*), self-contained so the scheduled `robot-runner` Edge
 * Function can execute the exact same rules server-side while the page is
 * closed. No I/O, no DOM, no npm imports — just math, so the paper/managed
 * robot behaves identically whether the browser or the server runs it.
 */

export type Side = 'long' | 'short'
export type Signal = 'buy' | 'sell' | 'neutral'
export type StrategyType = 'MA' | 'RSI' | 'MACD' | 'BOLLINGER'
export type Interval = '1min' | '5min' | '15min' | '30min' | '1h' | '4h' | '1day'
export type CloseReason = 'signal' | 'stop_loss' | 'take_profit' | 'manual' | 'risk' | 'robot_stop'
export type TradingMethod = 'scalping' | 'longterm'
export type StrategyMode = 'auto' | 'manual'

export interface Bar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface RatesMap {
  [symbol: string]: number
}

export interface Position {
  id: string
  symbol: string
  side: Side
  units: number
  entryPrice: number
  entryTime: string
  stopPrice: number
  takeProfitPrice: number
  entryEquity: number
  strategy?: string
  status: 'open'
}

export interface ClosedTrade {
  id: string
  symbol: string
  side: Side
  units: number
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  stopPrice: number
  takeProfitPrice: number
  entryEquity: number
  pnl: number
  pnlPct: number
  closeReason: CloseReason
  strategy?: string
  status: 'closed'
}

export interface RiskConfig {
  riskPerTradePct: number
  maxOpenPositions: number
  defaultStopPips: number
  takeProfitRatio: number
  maxDailyLossPct: number
  autoTrade: boolean
  trailingStop: boolean
  trailPips: number
  breakEvenPips: number
  trailActivationPips: number
  maxConsecutiveLosses: number
  adaptiveRisk: boolean
  volatilityFilter: boolean
}

export const DEFAULT_RISK: RiskConfig = {
  riskPerTradePct: 1,
  maxOpenPositions: 5,
  defaultStopPips: 20,
  takeProfitRatio: 2,
  maxDailyLossPct: 5,
  autoTrade: false,
  trailingStop: true,
  trailPips: 15,
  breakEvenPips: 10,
  trailActivationPips: 12,
  maxConsecutiveLosses: 0,
  adaptiveRisk: true,
  volatilityFilter: false,
}

export interface AccountState {
  id: string | null
  broker: 'paper' | 'managed'
  currency: 'USD'
  initialBalance: number
  balance: number
  risk: RiskConfig
  positions: Position[]
  trades: ClosedTrade[]
  createdAt: string | null
  updatedAt: string | null
}

export interface RobotConfig {
  pairs: string[]
  tradeMode: 'sequential' | 'concurrent'
  maxPerPair: number
  maxOpenTrades: number
}

export interface RobotCycleInput {
  symbol: string
  signal: Signal
  price: number
  rates: RatesMap
  strategy?: string
  stopPips: number
  takeProfitPips: number
  units: number
}

export interface BestStrategy {
  type: StrategyType
  signal: Signal
  score: number
}

export interface RankedPair {
  symbol: string
  score: number
  best: BestStrategy | null
  volatilityPct?: number
}

/* ------------------------------- indicators ------------------------------- */

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

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  const k = 2 / (period + 1)
  let prev: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (prev == null) {
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
    return (fast[i] as number) - (slow[i] as number)
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

export function atr(bars: Bar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null)
  if (bars.length < 2) return out
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]
    const b = bars[i]
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)))
  }
  if (trs.length < period) return out
  let sum = 0
  for (let i = 0; i < period; i++) sum += trs[i]
  let prevAtr = sum / period
  out[period] = prevAtr
  for (let i = period; i < trs.length; i++) {
    prevAtr = (prevAtr * (period - 1) + trs[i]) / period
    out[i + 1] = prevAtr
  }
  return out
}

/* -------------------------------- signals --------------------------------- */

function crossOver(prev: number | null | undefined, cur: number | null | undefined, line: number): boolean {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return false
  return prev <= line && cur > line
}

function crossUnder(prev: number | null | undefined, cur: number | null | undefined, line: number): boolean {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return false
  return prev >= line && cur < line
}

function clearsNoise(delta: number, atrVal: number, factor: number): boolean {
  if (!Number.isFinite(delta)) return false
  if (atrVal <= 0) return true
  return Math.abs(delta) >= factor * atrVal
}

function computeSignal(bars: Bar[], type: StrategyType): { signal: Signal; rsiVal: number | null; atrVal: number } {
  const closes = bars.map((b) => b.close)
  const last = bars.length - 1
  const prev = last - 1
  const atrVal = atr(bars, 14)[last] ?? 0
  const close = bars[last]?.close ?? 0
  const rsiCur = rsi(closes, 14)[last]

  switch (type) {
    case 'MA': {
      const fast = sma(closes, 10)
      const slow = sma(closes, 30)
      const fCur = fast[last]
      const fPrev = fast[prev]
      const sCur = slow[last]
      const spread = (fCur ?? 0) - (sCur ?? 0)
      const over = fCur != null && sCur != null && crossOver(fPrev, fCur, sCur) && fCur > sCur && clearsNoise(spread, atrVal, 0.25)
      const under = fCur != null && sCur != null && crossUnder(fPrev, fCur, sCur) && fCur < sCur && clearsNoise(spread, atrVal, 0.25)
      return { signal: over ? 'buy' : under ? 'sell' : 'neutral', rsiVal: rsiCur, atrVal }
    }
    case 'RSI': {
      const rCur = rsiCur
      const rPrev = rsi(closes, 14)[prev]
      const signal: Signal =
        rCur == null
          ? 'neutral'
          : crossOver(rPrev, rCur, 30) && rCur < 50
            ? 'buy'
            : crossUnder(rPrev, rCur, 70) && rCur > 50
              ? 'sell'
              : 'neutral'
      return { signal, rsiVal: rCur, atrVal }
    }
    case 'MACD': {
      const hist = macdHistogram(closes, 12, 26, 9)
      const hCur = hist[last]
      const hPrev = hist[prev]
      const minHist = close * 0.0002
      const signal: Signal =
        hCur == null
          ? 'neutral'
          : crossOver(hPrev, hCur, 0) && Math.abs(hCur) >= minHist
            ? 'buy'
            : crossUnder(hPrev, hCur, 0) && Math.abs(hCur) >= minHist
              ? 'sell'
              : 'neutral'
      return { signal, rsiVal: rsiCur, atrVal }
    }
    case 'BOLLINGER': {
      const { upper, lower } = bollinger(closes, 20, 2)
      const up = upper[last]
      const lo = lower[last]
      const c = close
      const signal: Signal =
        up == null || lo == null
          ? 'neutral'
          : c <= lo && (rsiCur == null || rsiCur < 50)
            ? 'buy'
            : c >= up && (rsiCur == null || rsiCur > 50)
              ? 'sell'
              : 'neutral'
      return { signal, rsiVal: rsiCur, atrVal }
    }
  }
}

/* ----------------------------- best strategy ------------------------------ */

const STRATEGY_TYPES: StrategyType[] = ['MA', 'RSI', 'MACD', 'BOLLINGER']

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

export function bestStrategyFor(bars: Bar[], _interval: Interval): BestStrategy | null {
  if (!Array.isArray(bars) || bars.length < 30) return null
  const momentum = momentumStrength(bars)
  const closes = bars.map((b) => b.close)
  const last = bars.length - 1
  const atrVal = atr(bars, 14)[last] ?? 0
  const atrPct = closes[last] > 0 ? (atrVal / closes[last]) * 100 : 0
  const rsiVal = rsi(closes, 14)[last]
  const sma20 = sma(closes, 20)[last]
  const trendAlign = sma20 != null ? (closes[last] > sma20 ? 1 : -1) : 0

  let best: BestStrategy | null = null
  for (const type of STRATEGY_TYPES) {
    const { signal } = computeSignal(bars, type)
    if (signal === 'neutral') continue
    let score = 45 + momentum * 140
    if (trendAlign !== 0) {
      score += (signal === 'buy' ? trendAlign : -trendAlign) * 12
    }
    if (rsiVal != null) {
      score += signal === 'buy' ? Math.max(0, 50 - rsiVal) * 0.5 : Math.max(0, rsiVal - 50) * 0.5
    }
    if (atrPct > 2) score -= Math.min(20, (atrPct - 2) * 5)
    const rounded = Math.round(Math.min(99, Math.max(5, score)))
    if (!best || rounded > best.score) {
      best = { type, signal, score: rounded }
    }
  }
  return best
}

function recentVolatilityPct(bars: Bar[]): number {
  if (bars.length < 15) return Number.POSITIVE_INFINITY
  const last = bars[bars.length - 1]
  const atrVal = atr(bars, 14)[bars.length - 1]
  if (atrVal == null || atrVal <= 0 || !(last.close > 0)) return Number.POSITIVE_INFINITY
  return (atrVal / last.close) * 100
}

export function rankPairs(barsBySymbol: Record<string, Bar[]>, interval: Interval): RankedPair[] {
  const out: RankedPair[] = []
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!Array.isArray(bars) || bars.length === 0) continue
    const best = bestStrategyFor(bars, interval)
    out.push({ symbol, score: best?.score ?? 0, best, volatilityPct: recentVolatilityPct(bars) })
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const va = a.volatilityPct ?? Number.POSITIVE_INFINITY
    const vb = b.volatilityPct ?? Number.POSITIVE_INFINITY
    return va - vb
  })
  return out
}

export function manualTargets(
  barsBySymbol: Record<string, Bar[]>,
  type: StrategyType,
  interval: Interval,
): RankedPair[] {
  const out: RankedPair[] = []
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!Array.isArray(bars) || bars.length < 30) continue
    const { signal } = computeSignal(bars, type)
    if (signal === 'neutral') continue
    const best = bestStrategyFor(bars, interval)
    const fallback: BestStrategy = { type, signal, score: 50 }
    out.push({ symbol, score: best?.score ?? 50, best: best ?? fallback })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

export function intervalForMethod(method: TradingMethod): Interval {
  return method === 'longterm' ? '1h' : '5min'
}

export const STRATEGY_LABELS: Record<StrategyType, string> = {
  MA: 'MA Cross',
  RSI: 'RSI',
  MACD: 'MACD',
  BOLLINGER: 'Bollinger',
}

/* --------------------------------- risk ----------------------------------- */

const CRYPTO_RE = /BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC/

export function pipSize(symbol: string): number {
  if (CRYPTO_RE.test(symbol)) return 1
  if (symbol.endsWith('JPY')) return 0.01
  return 0.0001
}

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
  const cross = rates[`${quote}/USD`]
  if (cross && cross > 0) return cross
  const inv = rates[`USD/${quote}`]
  if (inv && inv > 0) return 1 / inv
  return null
}

export function pipValueUsd(symbol: string, rates: RatesMap): number | null {
  const per = usdPerUnit(symbol, rates)
  if (per == null) return null
  return pipSize(symbol) * per
}

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

export function stopDistanceFromAtr(bars: Bar[], symbol: string): number {
  if (bars.length < 3) return 1
  let sum = 0
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]
    const b = bars[i]
    const tr = Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close))
    sum += tr
  }
  const atrVal = sum / (bars.length - 1)
  const pips = Math.round(atrVal / pipSize(symbol))
  return Math.max(1, pips)
}

export function suggestPositionUnits(input: {
  equity: number
  riskPct: number
  stopPips: number
  pipValue: number
}): number {
  if (input.equity <= 0 || input.stopPips <= 0 || input.pipValue <= 0) return 0
  const riskAmount = (input.equity * input.riskPct) / 100
  if (riskAmount <= 0) return 0
  const costPerUnit = input.stopPips * input.pipValue
  const units = Math.floor(riskAmount / costPerUnit)
  return Math.max(1, units)
}

export function consecutiveLosses(trades: ClosedTrade[]): number {
  let streak = 0
  for (const t of trades) {
    if (t.pnl >= 0) break
    if (t.closeReason === 'manual' || t.closeReason === 'robot_stop') break
    streak++
  }
  return streak
}

export function effectiveRiskPct(state: AccountState): number {
  const base = state.risk.riskPerTradePct
  if (!state.risk.adaptiveRisk) return base
  const streak = consecutiveLosses(state.trades)
  const multiplier = Math.max(0.5, 1 - streak * 0.1)
  return Math.max(0.25, base * multiplier)
}

/* -------------------------------- engine ---------------------------------- */

export function equity(state: AccountState, rates: RatesMap): number {
  return state.balance + unrealizedPnl(state, rates)
}

export function unrealizedPnl(state: AccountState, rates: RatesMap): number {
  let total = 0
  for (const p of state.positions) {
    const cur = rates[p.symbol]
    if (cur != null) total += pnlUsd(p.side, p.entryPrice, cur, p.units, p.symbol, rates)
  }
  return total
}

function trailStops(state: AccountState, rates: RatesMap): AccountState {
  let positions = state.positions
  for (const p of positions) {
    const cur = rates[p.symbol]
    if (cur == null) continue
    const pipSizeValue = pipSize(p.symbol)
    const profitPips = (p.side === 'long' ? cur - p.entryPrice : p.entryPrice - cur) / pipSizeValue

    if (profitPips >= state.risk.breakEvenPips) {
      if (p.side === 'long' && p.stopPrice < p.entryPrice) {
        positions = positions.map((x) => (x.id === p.id ? { ...x, stopPrice: p.entryPrice } : x))
      } else if (p.side === 'short' && p.stopPrice > p.entryPrice) {
        positions = positions.map((x) => (x.id === p.id ? { ...x, stopPrice: p.entryPrice } : x))
      }
    }

    if (profitPips >= state.risk.trailActivationPips) {
      const trail = state.risk.trailPips * pipSizeValue
      const newStop = p.side === 'long' ? cur - trail : cur + trail
      const currentStop = positions.find((x) => x.id === p.id)?.stopPrice ?? p.stopPrice
      const improved = p.side === 'long' ? newStop > currentStop : newStop < currentStop
      if (improved) {
        positions = positions.map((x) => (x.id === p.id ? { ...x, stopPrice: newStop } : x))
      }
    }
  }
  return positions === state.positions ? state : { ...state, positions }
}

export function markToMarket(
  state: AccountState,
  rates: RatesMap,
): { state: AccountState; closed: ClosedTrade[] } {
  let next = state
  const closed: ClosedTrade[] = []
  if (state.risk.trailingStop && state.risk.trailPips > 0) {
    next = trailStops(next, rates)
  }
  for (const p of next.positions) {
    const cur = rates[p.symbol]
    if (cur == null) continue
    let reason: CloseReason | null = null
    if (p.side === 'long') {
      if (cur <= p.stopPrice) reason = 'stop_loss'
      else if (cur >= p.takeProfitPrice) reason = 'take_profit'
    } else {
      if (cur >= p.stopPrice) reason = 'stop_loss'
      else if (cur <= p.takeProfitPrice) reason = 'take_profit'
    }
    if (reason) {
      const res = closePosition(next, p.id, { price: cur, reason, rates })
      if (res.trade) closed.push(res.trade)
      next = res.state
    }
  }
  return { state: next, closed }
}

export function closePosition(
  state: AccountState,
  positionId: string,
  opts: { price: number; reason: CloseReason; rates: RatesMap; time?: string },
): { state: AccountState; trade: ClosedTrade | null } {
  const pos = state.positions.find((p) => p.id === positionId)
  if (!pos) return { state, trade: null }
  const now = opts.time ?? new Date().toISOString()
  const pnl = pnlUsd(pos.side, pos.entryPrice, opts.price, pos.units, pos.symbol, opts.rates)
  const pnlPct = pos.entryEquity > 0 ? (pnl / pos.entryEquity) * 100 : 0
  const trade: ClosedTrade = {
    id: pos.id,
    symbol: pos.symbol,
    side: pos.side,
    units: pos.units,
    entryPrice: pos.entryPrice,
    entryTime: pos.entryTime,
    exitPrice: opts.price,
    exitTime: now,
    stopPrice: pos.stopPrice,
    takeProfitPrice: pos.takeProfitPrice,
    entryEquity: pos.entryEquity,
    pnl,
    pnlPct,
    closeReason: opts.reason,
    strategy: pos.strategy,
    status: 'closed',
  }
  return {
    state: {
      ...state,
      balance: state.balance + pnl,
      positions: state.positions.filter((p) => p.id !== positionId),
      trades: [trade, ...state.trades],
      updatedAt: now,
    },
    trade,
  }
}

export function openPosition(
  state: AccountState,
  input: {
    symbol: string
    side: Side
    entryPrice: number
    stopPips: number
    takeProfitPips: number
    units: number
    strategy?: string
    time?: string
  },
  rates: RatesMap,
  opts: { maxPerPair?: number } = {},
): { state: AccountState; error: string | null } {
  const risk = state.risk
  const maxPerPair = opts.maxPerPair ?? 1
  if (!input.entryPrice || input.entryPrice <= 0) return { state, error: 'No valid price to open at.' }
  if (input.units <= 0) return { state, error: 'Position size is too small to trade.' }
  if (input.stopPips <= 0) return { state, error: 'A stop loss is required on every position.' }
  const onSymbol = state.positions.filter((p) => p.symbol === input.symbol).length
  if (onSymbol >= maxPerPair) {
    return {
      state,
      error: maxPerPair === 1 ? `A ${input.symbol} position is already open.` : `Max ${maxPerPair} ${input.symbol} positions already open.`,
    }
  }
  if (state.positions.length >= risk.maxOpenPositions) {
    return { state, error: `Max ${risk.maxOpenPositions} open positions reached.` }
  }
  const gate = canOpen(state, rates)
  if (!gate.ok) return { state, error: gate.reason ?? 'Risk limits block this trade.' }

  const now = input.time ?? new Date().toISOString()
  const { stopPrice, takeProfitPrice } = stopTakePrices(
    input.symbol,
    input.side,
    input.entryPrice,
    input.stopPips,
    Math.max(0, input.takeProfitPips),
  )

  const position: Position = {
    id: crypto.randomUUID(),
    symbol: input.symbol,
    side: input.side,
    units: input.units,
    entryPrice: input.entryPrice,
    entryTime: now,
    stopPrice,
    takeProfitPrice,
    entryEquity: equity(state, rates),
    strategy: input.strategy,
    status: 'open',
  }

  return { state: { ...state, positions: [...state.positions, position], updatedAt: now }, error: null }
}

export function todayPnlUsd(state: AccountState, rates: RatesMap): number {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const startMs = startOfDay.getTime()
  let total = 0
  for (const t of state.trades) {
    if (new Date(t.exitTime).getTime() >= startMs) total += t.pnl
  }
  return total + unrealizedPnl(state, rates)
}

export function canOpen(state: AccountState, rates: RatesMap): { ok: boolean; reason?: string } {
  const maxLosses = state.risk.maxConsecutiveLosses
  if (maxLosses > 0) {
    const streak = consecutiveLosses(state.trades)
    if (streak >= maxLosses) {
      return {
        ok: false,
        reason: `${streak} losses in a row — the robot is standing down. Raise the consecutive-loss limit or let a win reset the streak.`,
      }
    }
  }
  const limitPct = state.risk.maxDailyLossPct
  if (limitPct > 0) {
    const limitUsd = (state.initialBalance * limitPct) / 100
    if (todayPnlUsd(state, rates) <= -limitUsd) {
      return {
        ok: false,
        reason: `Daily loss limit (${limitPct}%) reached — the robot is standing down until tomorrow.`,
      }
    }
  }
  return { ok: true }
}

export function runRobotCycle(
  state: AccountState,
  inputs: RobotCycleInput[],
  config: RobotConfig,
): { state: AccountState; events: string[] } {
  let next = state
  const events: string[] = []

  for (const input of inputs) {
    const { symbol, signal, price, rates, strategy, stopPips, takeProfitPips, units } = input
    if (signal === 'neutral') continue

    const side: Side = signal === 'buy' ? 'long' : 'short'
    const openOnSymbol = next.positions.filter((p) => p.symbol === symbol).length
    const perPairCap = config.tradeMode === 'concurrent' ? config.maxPerPair : 1

    if (openOnSymbol >= perPairCap) {
      events.push(`Skipped ${symbol}: ${openOnSymbol} open, per-pair cap ${perPairCap} reached.`)
      continue
    }
    if (config.maxOpenTrades > 0 && next.positions.length >= config.maxOpenTrades) {
      events.push(`Deferred ${symbol}: global cap ${config.maxOpenTrades} reached.`)
      continue
    }

    const gate = canOpen(next, rates)
    if (!gate.ok) {
      events.push(gate.reason ?? `${symbol}: risk limits block this trade.`)
      continue
    }

    const res = openPosition(
      next,
      { symbol, side, entryPrice: price, stopPips, takeProfitPips, units, strategy },
      rates,
      { maxPerPair: perPairCap },
    )
    if (res.error) {
      events.push(`${symbol}: ${res.error}`)
      continue
    }
    next = res.state
    events.push(`Opened ${symbol} ${side} at ${price.toFixed(5)}.`)
  }

  return { state: next, events }
}

/** Close only the positions the robot opened (strategy-tagged, not 'manual'). */
export function closeRobotPositions(
  state: AccountState,
  rates: RatesMap,
): { state: AccountState; closed: ClosedTrade[] } {
  let next = state
  const closed: ClosedTrade[] = []
  for (const p of state.positions) {
    if (!p.strategy || p.strategy === 'manual') continue
    const cur = rates[p.symbol] ?? p.entryPrice
    const res = closePosition(next, p.id, { price: cur, reason: 'robot_stop', rates })
    if (res.trade) closed.push(res.trade)
    next = res.state
  }
  return { state: next, closed }
}

export function closeAllPositions(
  state: AccountState,
  rates: RatesMap,
): { state: AccountState; closed: ClosedTrade[] } {
  let next = state
  const closed: ClosedTrade[] = []
  for (const p of state.positions) {
    const cur = rates[p.symbol] ?? p.entryPrice
    const res = closePosition(next, p.id, { price: cur, reason: 'risk', rates })
    if (res.trade) closed.push(res.trade)
    next = res.state
  }
  return { state: next, closed }
}
