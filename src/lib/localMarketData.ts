/**
 * Direct-to-provider market data for when the platform's Edge Function isn't
 * reachable (e.g. a local sandbox with no Supabase env vars). Uses the same
 * free, keyless sources as the edge function's fallback — Binance public API
 * for crypto, Yahoo Finance for FX — so the app stays fully live with no API
 * key and no backend.
 *
 * The Edge Function remains the primary path (server-side caching, provider
 * fallback chain, Realtime broadcast); this module only kicks in when Supabase
 * is not configured or its function fails.
 */
import type { Bar, Interval, Quote } from './types'
import { WATCHLIST, isCryptoPair } from './watchlist'

const YH_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'
const BN_BASE = 'https://api.binance.com/api/v3'

/** `AAA/BBB` -> Yahoo symbol (FX `EURUSD=X`, crypto `BTC-USD`). */
export function yahooSymbol(symbol: string): string {
  const [from, to] = symbol.split('/')
  if (!from || !to) return symbol
  return isCryptoPair(symbol) ? `${from}-${to}` : `${from}${to}=X`
}

/** `AAA/BBB` -> Binance spot symbol (`USD` is mapped to `USDT`). */
export function binanceSymbol(symbol: string): string {
  const [from, to] = symbol.split('/')
  if (!from) return symbol
  const quote = to && to.trim().toUpperCase() !== 'USD' ? to.trim().toUpperCase() : 'USDT'
  return `${from.toUpperCase()}${quote}`
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function optNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** `AAA/BBB` -> Yahoo chart path, e.g. `EURUSD=X`, `BTC-USD`. */
function yahooChartUrl(symbol: string, interval: string, range: string): string {
  return `${YH_BASE}/${encodeURIComponent(yahooSymbol(symbol))}?interval=${interval}&range=${range}`
}

interface YahooMeta {
  regularMarketPrice?: number
  chartPreviousClose?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  regularMarketOpen?: number
  regularMarketTime?: number
}

async function yahooQuote(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(yahooChartUrl(symbol, '1d', '1d'), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ANA24/1.0)' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      chart?: { result?: Array<{ meta?: YahooMeta }>; error?: { code?: string; description?: string } | null }
    }
    if (data.chart?.error) return null
    const meta = data.chart?.result?.[0]?.meta
    const price = optNum(meta?.regularMarketPrice)
    if (price == null) return null
    const prev = optNum(meta?.chartPreviousClose)
    const change = prev != null ? price - prev : null
    return {
      symbol,
      price,
      change,
      percent_change: change != null && prev != null && prev !== 0 ? (change / prev) * 100 : null,
      open: optNum(meta?.regularMarketOpen),
      high: optNum(meta?.regularMarketDayHigh),
      low: optNum(meta?.regularMarketDayLow),
      previous_close: prev,
      is_market_open: isCryptoPair(symbol) || isFxOpenNow(),
      datetime: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    }
  } catch {
    return null
  }
}

/** Forex session check (UTC) — crypto is always open. */
function isFxOpenNow(): boolean {
  const now = new Date()
  const day = now.getUTCDay()
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  if (day === 0) return hour >= 22
  if (day >= 1 && day <= 4) return hour < 21 || hour >= 22
  if (day === 5) return hour < 21
  return false
}

interface BinanceTicker {
  symbol?: string
  lastPrice?: string
  openPrice?: string
  highPrice?: string
  lowPrice?: string
  prevClosePrice?: string
  priceChange?: string
  priceChangePercent?: string
  closeTime?: number
}

async function binanceBatchQuote(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>()
  const unique = [...new Set(symbols)]
  if (unique.length === 0) return out
  const reverse = new Map<string, string>()
  for (const s of unique) reverse.set(binanceSymbol(s), s)
  try {
    const res = await fetch(`${BN_BASE}/ticker?symbols=${encodeURIComponent(JSON.stringify([...reverse.keys()]))}`)
    if (res.status === 429 || res.status === 418 || !res.ok) return out
    const data = (await res.json()) as BinanceTicker[] | { code?: number } | null
    if (!Array.isArray(data)) return out
    for (const d of data) {
      const orig = d.symbol ? reverse.get(d.symbol) : undefined
      if (!orig) continue
      const price = num(d.lastPrice ?? '')
      if (price <= 0) continue
      out.set(orig, {
        symbol: orig,
        price,
        change: optNum(d.priceChange),
        percent_change: optNum(d.priceChangePercent),
        open: optNum(d.openPrice),
        high: optNum(d.highPrice),
        low: optNum(d.lowPrice),
        previous_close: optNum(d.prevClosePrice),
        is_market_open: true,
        datetime: d.closeTime ? new Date(d.closeTime).toISOString() : null,
      })
    }
  } catch {
    // Non-fatal — caller falls back per-symbol to Yahoo.
  }
  return out
}

/**
 * Fresh quotes for the full watchlist, straight from the browser. Crypto comes
 * from one batched Binance call; FX rotates through Yahoo one symbol at a time
 * (no key, no credit cost, light per-call cadence).
 */
export async function localQuotes(): Promise<Quote[]> {
  const symbols = WATCHLIST.map((p) => p.symbol)
  const crypto = symbols.filter(isCryptoPair)
  const fx = symbols.filter((s) => !isCryptoPair(s))

  const batch = await binanceBatchQuote(crypto)
  const quotes = new Map<string, Quote>(batch)

  // Symbols Binance didn't return (or a failed batch) -> one-off Yahoo fallback.
  for (const s of crypto) {
    if (quotes.has(s)) continue
    const q = await yahooQuote(s)
    if (q) quotes.set(s, q)
  }

  // FX — one Yahoo call per symbol, keep it light.
  for (const s of fx) {
    const q = await yahooQuote(s)
    if (q) quotes.set(s, q)
  }

  return WATCHLIST.map((p) => quotes.get(p.symbol)).filter((q): q is Quote => q != null)
}

const YH_INTERVALS: Record<string, string> = {
  '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '60m', '4h': '60m', '1day': '1d',
}
const YH_RANGES: Record<string, string> = {
  '1min': '1d', '5min': '5d', '15min': '5d', '30min': '1mo', '1h': '1mo', '4h': '3mo', '1day': '1y',
}

/** Merge `n` consecutive bars into one (4h bars come from 60m). */
function aggregateBars(bars: Bar[], n: number): Bar[] {
  const out: Bar[] = []
  for (let i = 0; i < bars.length; i += n) {
    const chunk = bars.slice(i, i + n)
    if (chunk.length === 0) continue
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((b) => b.high)),
      low: Math.min(...chunk.map((b) => b.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, b) => s + (b.volume ?? 0), 0),
    })
  }
  return out
}

/** Binance klines (crypto only, native 4h/1d). */
async function binanceTimeSeries(symbol: string, interval: string, outputsize: number): Promise<Bar[] | null> {
  const map: Record<string, string> = {
    '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '1h', '4h': '4h', '1day': '1d',
  }
  try {
    const res = await fetch(
      `${BN_BASE}/klines?symbol=${encodeURIComponent(binanceSymbol(symbol))}&interval=${map[interval] ?? '5m'}&limit=${Math.min(outputsize, 1000)}`,
    )
    if (res.status === 429 || res.status === 418 || !res.ok) return null
    const data = (await res.json()) as unknown[] | { code?: number } | null
    if (!Array.isArray(data) || data.length === 0) return null
    return (data as Array<Array<number | string>>).map((k) => ({
      time: new Date(Number(k[0])).toISOString(),
      open: num(k[1]),
      high: num(k[2]),
      low: num(k[3]),
      close: num(k[4]),
      volume: k[5] != null ? num(k[5]) : undefined,
    }))
  } catch {
    return null
  }
}

/** Yahoo chart bars (FX + crypto fallback). */
async function yahooTimeSeries(symbol: string, interval: string, outputsize: number): Promise<Bar[] | null> {
  const iv = YH_INTERVALS[interval] ?? '5m'
  const range = YH_RANGES[interval] ?? '5d'
  try {
    const res = await fetch(yahooChartUrl(symbol, iv, range), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ANA24/1.0)' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[]
          indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> }
        }>
        error?: { code?: string } | null
      }
    }
    if (data.chart?.error) return null
    const result = data.chart?.result?.[0]
    const q = result?.indicators?.quote?.[0]
    const ts = result?.timestamp ?? []
    if (!ts.length || !q) return null
    const bars: Bar[] = []
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
      if (o == null || h == null || l == null || c == null) continue
      bars.push({
        time: new Date(ts[i] * 1000).toISOString(),
        open: o, high: h, low: l, close: c,
        volume: q.volume?.[i] != null ? (q.volume[i] as number) : undefined,
      })
    }
    let out = bars
    if (interval === '4h') out = aggregateBars(out, 4)
    return out.slice(-outputsize)
  } catch {
    return null
  }
}

/**
 * OHLC bars for the chart / signals, straight from the browser.
 * Crypto prefers Binance (cheap, no user-agent issues), FX goes to Yahoo.
 */
export async function localTimeSeries(symbol: string, interval: Interval, outputsize: number): Promise<Bar[] | null> {
  if (isCryptoPair(symbol)) {
    const bin = await binanceTimeSeries(symbol, interval, outputsize)
    if (bin) return bin
  }
  return yahooTimeSeries(symbol, interval, outputsize)
}
