/**
 * LiveChartPanel — interactive price chart for the trading page. Lets the
 * trader pick a watchlist symbol and interval, fetches fresh bars through the
 * market-data Edge Function and renders them with the shared candlestick chart.
 */
import { useEffect, useState } from 'react'
import { LineChart } from 'lucide-react'
import type { Bar, Interval } from '../../lib/types'
import { fetchTimeSeries } from '../../hooks/useMarketData'
import { INTERVALS } from '../../lib/strategies'
import { WATCHLIST } from '../../lib/watchlist'
import { CandleChart } from '../CandleChart'
import { Card, CardContent, CardHeader, CardTitle, Select, Skeleton } from '../ui'

export function LiveChartPanel({
  initialSymbol,
  initialInterval,
}: {
  initialSymbol: string
  initialInterval: Interval
}) {
  const [symbol, setSymbol] = useState(initialSymbol)
  const [interval, setInterval] = useState<Interval>(initialInterval)
  const [bars, setBars] = useState<Bar[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setBars(null)
    void (async () => {
      const res = await fetchTimeSeries({ symbol, interval, outputsize: 300 })
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
  }, [symbol, interval])

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
            value={interval}
            onChange={(e) => setInterval(e.target.value as Interval)}
            className="w-32"
            aria-label="Chart interval"
          >
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
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
        ) : bars ? (
          <CandleChart bars={bars} height={300} />
        ) : null}
      </CardContent>
    </Card>
  )
}
