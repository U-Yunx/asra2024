import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bar, Interval, Quote } from '../lib/types'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export type MarketKind = 'ok' | 'no_api_key' | 'rate_limited' | 'error'

export interface InvokeResult<T> {
  data: T | null
  error: string | null
  kind: MarketKind
}

interface MarketError {
  error?: string
  message?: string
}

function parseMarketError(res: unknown): InvokeResult<never> {
  const e = (res ?? {}) as MarketError
  if (e.error === 'no_api_key') {
    return {
      data: null,
      kind: 'no_api_key',
      error:
        'Market data has no active source yet — enable the built-in free feed in Configuration → Market data, or ask an admin to add a provider key.',
    }
  }
  if (e.error === 'rate_limited') {
    return { data: null, kind: 'rate_limited', error: 'Market data is temporarily unavailable. Please try again shortly.' }
  }
  if (e.error) {
    return { data: null, kind: 'error', error: e.message ?? 'Market data is unavailable right now.' }
  }
  return { data: null, kind: 'error', error: 'Market data is unavailable right now.' }
}

/**
 * Calls the `market-data` Edge Function (server-side Twelve Data proxy).
 * The Twelve Data API key never leaves the server.
 */
async function invokeMarketData<T>(payload: Record<string, unknown>): Promise<InvokeResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('market-data', { body: payload })
    if (error) {
      return { data: null, kind: 'error', error: 'Could not reach the market data service. Please try again.' }
    }
    if (data && typeof data === 'object' && 'error' in (data as object)) {
      return parseMarketError(data)
    }
    return { data: data as T, kind: 'ok', error: null }
  } catch {
    return { data: null, kind: 'error', error: 'Could not reach the market data service. Please try again.' }
  }
}

interface QuotesResponse {
  quotes: Quote[]
  anyStale: boolean
}

/**
 * Fetches the live watchlist quotes. Pass `priority` (e.g. the pairs the robot
 * is trading) so those symbols are refreshed first by the Edge Function.
 */
export async function fetchQuotes(priority?: string[]): Promise<InvokeResult<Quote[]>> {
  const body: Record<string, unknown> = { action: 'quotes' }
  if (priority && priority.length > 0) body.priority = priority
  const res = await invokeMarketData<QuotesResponse>(body)
  if (res.kind !== 'ok') {
    return { data: null, error: res.error, kind: res.kind }
  }
  return { data: res.data?.quotes ?? null, error: null, kind: 'ok' }
}

export interface TimeSeriesRequest {
  symbol: string
  interval: Interval
  outputsize: number
  startDate?: string
  endDate?: string
}

interface TimeSeriesResponse {
  bars: Bar[]
}

export async function fetchTimeSeries(req: TimeSeriesRequest): Promise<InvokeResult<Bar[]>> {
  const res = await invokeMarketData<TimeSeriesResponse>({
    action: 'time_series',
    symbol: req.symbol,
    interval: req.interval,
    outputsize: req.outputsize,
    start_date: req.startDate,
    end_date: req.endDate,
  })
  if (res.kind !== 'ok') {
    return { data: null, error: res.error, kind: res.kind }
  }
  return { data: res.data?.bars ?? null, error: null, kind: 'ok' }
}

export interface UseQuotesState {
  quotes: Quote[] | null
  loading: boolean
  error: string | null
  kind: MarketKind
  stale: boolean
  lastUpdated: number | null
}

interface BroadcastMessage {
  quotes?: Quote[]
  anyStale?: boolean
  at?: number
}

/**
 * Live quotes for the watchlist.
 *
 * Realtime-first: the `market-data` Edge Function broadcasts refreshed quotes
 * on the `market-quotes` channel, so every open page updates the moment fresh
 * data lands (no waiting for the poll). A poll interval is kept as a fallback
 * for when Realtime is unavailable. Pass `priority` (e.g. the robot's pairs) so
 * the Edge Function refreshes those symbols first.
 */
export function useQuotes(
  pollMs = 15_000,
  priority?: string[],
): UseQuotesState & { refresh: () => void } {
  const [state, setState] = useState<UseQuotesState>({
    quotes: null,
    loading: true,
    error: null,
    kind: 'ok',
    stale: false,
    lastUpdated: null,
  })
  const mounted = useRef(true)
  const priorityRef = useRef(priority)
  priorityRef.current = priority

  // Realtime broadcast — the primary update path.
  useEffect(() => {
    if (!isSupabaseConfigured || typeof supabase.channel !== 'function') return
    const channel = supabase.channel('market-quotes')
    channel
      .on('broadcast', { event: 'quotes' }, (payload) => {
        const msg = payload as unknown as BroadcastMessage
        if (!mounted.current) return
        if (!Array.isArray(msg.quotes) || msg.quotes.length === 0) return
        setState({
          quotes: msg.quotes,
          loading: false,
          error: null,
          kind: 'ok',
          stale: msg.anyStale ?? msg.quotes.some((q) => q.stale),
          lastUpdated: msg.at ?? Date.now(),
        })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }))
    const res = await fetchQuotes(priorityRef.current)
    if (!mounted.current) return
    if (res.kind === 'ok') {
      setState({
        quotes: res.data ?? [],
        loading: false,
        error: null,
        kind: 'ok',
        stale: (res.data ?? []).some((q) => q.stale),
        lastUpdated: Date.now(),
      })
    } else {
      setState((s) => ({
        ...s,
        loading: false,
        error: res.error,
        kind: res.kind,
        stale: s.stale,
      }))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    load(false)
    const id = setInterval(() => load(true), pollMs)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [load, pollMs])

  const refresh = useCallback(() => load(false), [load])
  return { ...state, refresh }
}