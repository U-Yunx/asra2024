/**
 * Signals — indicator-driven buy/sell/neutral signals for the watchlist. Picks
 * a pair, loads bars, computes the signal for the selected strategy and shows
 * the indicator values that produced it, alongside the live quote table.
 */
import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import type { Bar, StrategyConfig } from '../lib/types'
import { DEFAULT_STRATEGY } from '../hooks/useSelectedStrategy'
import { fetchTimeSeries, useQuotes } from '../hooks/useMarketData'
import { computeSignal } from '../lib/strategies/signals'
import { STRATEGY_META } from '../lib/strategies'
import { formatPrice } from '../lib/format'
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader, Select, Skeleton, EmptyState } from '../components/ui'
import { SignalBadge } from '../components/SignalBadge'
import { QuoteTable } from '../components/QuoteTable'

export function Signals() {
  const { quotes, loading: quotesLoading } = useQuotes()
  const [strategy, setStrategy] = useState<StrategyConfig>(DEFAULT_STRATEGY)
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (pair: string) => {
    setLoading(true)
    setError(null)
    const res = await fetchTimeSeries({ symbol: pair, interval: strategy.interval, outputsize: 200 })
    setLoading(false)
    if (res.kind !== 'ok' || !res.data || res.data.length < 30) {
      setError(res.error ?? 'Not enough data for this pair right now.')
      setBars([])
      return
    }
    setBars(res.data)
  }

  useEffect(() => {
    void load(strategy.pair)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy.pair, strategy.interval, strategy.type])

  const signal = useMemo(
    () => (bars.length > 0 ? computeSignal(bars, strategy) : null),
    [bars, strategy],
  )

  const price = quotes?.find((q) => q.symbol === strategy.pair)?.price

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live signals"
        description="Indicator-driven signals computed from recent price action."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
                Signal for {strategy.pair}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select label="Pair" value={strategy.pair} onChange={(e) => setStrategy({ ...strategy, pair: e.target.value })}>
                {(quotes ?? []).map((q) => (
                  <option key={q.symbol} value={q.symbol}>
                    {q.symbol}
                  </option>
                ))}
              </Select>
              <Select
                className="mt-3"
                label="Strategy"
                value={strategy.type}
                onChange={(e) => setStrategy({ ...strategy, type: e.target.value as StrategyConfig['type'] })}
              >
                {(Object.keys(STRATEGY_META) as StrategyConfig['type'][]).map((t) => (
                  <option key={t} value={t}>
                    {STRATEGY_META[t].name}
                  </option>
                ))}
              </Select>

              {loading && <Skeleton className="mt-4 h-24 w-full" />}

              {!loading && signal && (
                <div className="mt-4">
                  <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Signal</p>
                      <SignalBadge signal={signal.signal} className="mt-1" />
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Price</p>
                      <p className="tnum font-mono text-lg font-bold text-foreground">{formatPrice(price)}</p>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    Last {bars.length} bars on {strategy.interval} · {STRATEGY_META[strategy.type].shortLabel}
                  </p>

                  <div className="mt-3 space-y-1.5">
                    {signal.indicatorValues.map((iv) => (
                      <div
                        key={iv.label}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs"
                      >
                        <span className="text-muted-foreground">{iv.label}</span>
                        <span className="tnum font-mono text-foreground">{iv.value}</span>
                      </div>
                    ))}
                  </div>

                  <Button className="mt-4 w-full" variant="secondary" onClick={() => void load(strategy.pair)}>
                    Refresh
                  </Button>
                </div>
              )}

              {!loading && !signal && !error && (
                <EmptyState
                  title="No signal yet"
                  message="Loading price action for this pair…"
                />
              )}

              {error && (
                <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <QuoteTable quotes={quotes} loading={quotesLoading} />
        </div>
      </div>
    </div>
  )
}