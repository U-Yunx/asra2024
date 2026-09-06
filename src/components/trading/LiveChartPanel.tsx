/**
 * LiveChartPanel — interactive price chart for the trading page. Lets the
 * trader pick a watchlist symbol and interval, fetches fresh bars through the
 * market-data Edge Function and renders them with the shared candlestick chart.
 * When a live `rates` map is provided (the same quote feed as the rest of the
 * page) the newest candle ticks with the current price in real time, and bars
 * are re-fetched periodically so closed candles appear without changing the
 * pair or interval.
 */
import { useEffect, useMemo, useState } from 'react'
import { LineChart } from 'lucide-react'
import type { Bar, Interval } from '../../lib/types'
import type { RatesMap } from '../../lib/trading/types'
import { fetchTimeSeries } from '../../hooks/useMarketData'
import { INTERVALS } from '../../lib/strategies'
import { WATCHLIST } from '../../lib/watchlist'
import { formatPrice } from '../../lib/format'
import { CandleChart } from '../CandleChart'
import { Card, CardContent, CardHeader, CardTitle, Select, Skeleton } from '../ui'

/** How often to re-fetch bars for new candles (the function caches per-interval, so this stays cheap). */
const REFETCH_MS = 60_000

export function LiveChartPanel({
  initialSymbol,
  initialInterval,
  rates,
}: {
  initialSymbol: string
  initialInterval: Interval
  /** Live quote map from useQuotes — ticks the last candle in real time. */
  rates?: RatesMap
}) {
  const [symbol, setSymbol] = useState(initialSymbol)
  // Named `setChartInterval` so the global `setInterval` timer stays usable in
  // the periodic-refetch effect below (a `setInterval` state setter would shadow it).
  const [chartInterval, setChartInterval] = useState<Interval>(initialInterval)
  const [bars, setBars] = useState<Bar[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setBars(null)
    void (async () => {
      const res = await fetchTimeSeries({ symbol, interval: chartInterval, outputsize: 300 })
      if (!active) return
      setLoading(false)
      if (res.kind !== 'ok' || !res.data || res.data.length === 0) {
        setError(res.error ?? 'No chart data available for this pair right now.')
        return
      }
      setBars(res.data)
    })()
    return () => {
      active = false
    }
  }, [symbol, chartInterval])

  // Periodically re-fetch so new candles appear even when the pair/interval
  // hasn't changed. Modest cadence — the Edge Function serves bars from its
  // cache for the interval TTL, so this doesn't burn upstream credits.
  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        const res = await fetchTimeSeries({ symbol, interval: chartInterval, outputsize: 300 })
        if (res.kind === 'ok' && res.data && res.data.length > 0) {
          setBars(res.data)
          setError(null)
        }
      })()
    }, REFETCH_MS)
    return () => clearInterval(id)
  }, [symbol, chartInterval])

  // Live tick: extend the newest candle with the current price so the chart's
  // right edge moves in real time between bar re-fetches.
  const live = rates?.[symbol] ?? null
  const displayBars = useMemo(() => {
    if (!bars || live == null || bars.length === 0) return bars
    const last = bars[bars.length - 1]
    const ticked = bars.slice(0, -1)
    ticked.push({
      ...last,
      close: live,
      high: Math.max(last.high, live),
      low: Math.min(last.low, live),
    })
    return ticked
  }, [bars, live])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LineChart className="h-4 w-4 text-accent" aria-hidden="true" />
          Price chart
        </CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label="Pair"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-36"
            aria-label="Chart pair"
          >
            {WATCHLIST.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.symbol}
              </option>
            ))}
          </Select>
          <Select
            label="Interval"
            value={chartInterval}
            onChange={(e) => setChartInterval(e.target.value as Interval)}
            className="w-32"
            aria-label="Chart interval"
          >
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
          {live != null && (
            <span className="mb-1 font-mono tnum text-sm text-foreground" aria-live="polite">
              {formatPrice(live)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : error ? (
          <div
            role="alert"
            className="flex h-72 items-center justify-center rounded-lg border border-border bg-muted/30 px-4 text-center text-sm text-muted-foreground"
          >
            {error}
          </div>
        ) : displayBars ? (
          <CandleChart bars={displayBars} height={300} />
        ) : null}
      </CardContent>
    </Card>
  )
}
