/**
 * Backtester — pick a strategy, load historical bars, run the engine's
 * backtester and review the equity curve, metrics and every simulated trade.
 * Results are computed entirely client-side from the fetched bars.
 */
import { useState } from 'react'
import { Layers, Play, Sparkles } from 'lucide-react'
import type { Bar, StrategyConfig } from '../lib/types'
import { DEFAULT_STRATEGY } from '../hooks/useSelectedStrategy'
import { useSavedStrategies } from '../hooks/useSavedStrategies'
import { useAuth } from '../hooks/useAuth'
import { fetchTimeSeries } from '../hooks/useMarketData'
import { runBacktest, runMultiBacktest, type MultiBacktestSettings } from '../lib/strategies/backtest'
import { formatNum, formatPct, formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, PageHeader } from '../components/ui'
import { StrategyForm } from '../components/StrategyForm'
import { MetricsCards } from '../components/MetricsCards'
import { CandleChart } from '../components/CandleChart'
import { EquityChart } from '../components/EquityChart'
import { TradesTable } from '../components/TradesTable'
import { WATCHLIST } from '../lib/watchlist'
import type { TradeMode } from '../lib/trading/types'

export function Backtester() {
  const { user } = useAuth()
  const { strategies, save } = useSavedStrategies(user)
  const [strategy, setStrategy] = useState<StrategyConfig>(DEFAULT_STRATEGY)
  const [pairs, setPairs] = useState<string[]>([DEFAULT_STRATEGY.pair])
  const [tradeMode, setTradeMode] = useState<TradeMode>('sequential')
  const [maxPerPair, setMaxPerPair] = useState(1)
  const [maxOpenTrades, setMaxOpenTrades] = useState(3)
  const [barsBySymbol, setBarsBySymbol] = useState<Record<string, Bar[]>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ran, setRan] = useState(false)

  const togglePair = (symbol: string) =>
    setPairs((prev) => (prev.includes(symbol) ? prev.filter((x) => x !== symbol) : [...prev, symbol]))

  const multi = pairs.length > 1
  const settings: MultiBacktestSettings = { pairs, tradeMode, maxPerPair, maxOpenTrades }
  const result =
    ran && Object.keys(barsBySymbol).length > 0
      ? multi
        ? runMultiBacktest(barsBySymbol, strategy, settings)
        : runBacktest(barsBySymbol[pairs[0] ?? strategy.pair] ?? [], strategy)
      : null
  const primaryBars = barsBySymbol[strategy.pair] ?? barsBySymbol[pairs[0] ?? ''] ?? []

  const run = async () => {
    const targetPairs = pairs.length > 0 ? pairs : [strategy.pair]
    setLoading(true)
    setError(null)
    setRan(false)
    const results = await Promise.all(
      targetPairs.map((symbol) =>
        fetchTimeSeries({ symbol, interval: strategy.interval, outputsize: 400 }).then((res) => ({ symbol, res })),
      ),
    )
    setLoading(false)
    const loaded: Record<string, Bar[]> = {}
    const failed: string[] = []
    for (const { symbol, res } of results) {
      if (res.kind === 'ok' && res.data && res.data.length >= 30) loaded[symbol] = res.data
      else failed.push(symbol)
    }
    if (Object.keys(loaded).length === 0) {
      setError(
        'Not enough price data for any selected pair right now — try another pair or timeframe.',
      )
      return
    }
    setBarsBySymbol(loaded)
    setRan(true)
    if (failed.length > 0) {
      setError(`No data for ${failed.join(', ')} — showing results for the pairs that loaded.`)
    }
  }

  const handleSave = async (name: string) => {
    if (!name) return
    setSaving(true)
    await save({
      name,
      pair: strategy.pair,
      strategy_type: strategy.type,
      params: strategy.params,
      timeframe: strategy.interval,
    })
    setSaving(false)
  }

  const m = result?.metrics

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backtester"
        description="Load historical bars and see how a strategy would have performed."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <StrategyForm strategy={strategy} onChange={setStrategy} onSave={handleSave} saving={saving} saveLabel="Save strategy" />

          {/* Multi-pair watchlist + concurrency (mirrors the live robot's settings) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-accent" aria-hidden="true" />
                Pairs &amp; concurrency
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Watchlist — {pairs.length} pair{pairs.length === 1 ? '' : 's'}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {WATCHLIST.map((p) => {
                    const on = pairs.includes(p.symbol)
                    return (
                      <button
                        key={p.symbol}
                        type="button"
                        onClick={() => togglePair(p.symbol)}
                        aria-pressed={on}
                        className={cn(
                          'cursor-pointer rounded-lg border px-2 py-1.5 text-left text-xs',
                          on
                            ? 'border-accent/60 bg-accent/15 text-accent'
                            : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span className="font-medium">{p.symbol}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Add several pairs to backtest the robot as a whole — one shared equity curve with per-pair and
                  global caps, exactly like live trading.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Trade mode">
                {(['sequential', 'concurrent'] as TradeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTradeMode(mode)}
                    aria-pressed={tradeMode === mode}
                    className={cn(
                      'cursor-pointer rounded-lg border px-3 py-2 text-sm font-semibold',
                      tradeMode === mode
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {mode === 'sequential' ? 'Sequential' : 'Concurrent'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Max per pair"
                  type="number"
                  min={1}
                  step={1}
                  value={maxPerPair}
                  disabled={tradeMode === 'sequential'}
                  onChange={(e) => setMaxPerPair(Math.max(1, Math.round(Number(e.target.value))))}
                />
                <Input
                  label="Max open trades"
                  type="number"
                  min={1}
                  step={1}
                  value={maxOpenTrades}
                  onChange={(e) => setMaxOpenTrades(Math.max(1, Math.round(Number(e.target.value))))}
                />
              </div>
              {tradeMode === 'concurrent' && maxPerPair > maxOpenTrades && (
                <p role="alert" className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber">
                  Max per pair ({maxPerPair}) is above the global cap ({maxOpenTrades}) — the global cap wins.
                </p>
              )}
            </CardContent>
          </Card>

          <Button className="w-full" size="lg" loading={loading} onClick={() => void run()}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Run backtest
          </Button>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {!ran && !error && (
            <EmptyState
              icon={<Sparkles className="h-6 w-6" aria-hidden="true" />}
              title="Run your first backtest"
              message="Configure a strategy on the left, then press “Run backtest” to load historical data and see the simulated results."
            />
          )}

          {m && result && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-border bg-muted text-muted-foreground">
                  {Object.keys(barsBySymbol).length} pair{Object.keys(barsBySymbol).length === 1 ? '' : 's'}
                </Badge>
                <Badge className="border-accent/40 bg-accent/10 text-accent">
                  {tradeMode === 'concurrent' ? 'Concurrent' : 'Sequential'}
                </Badge>
                {tradeMode === 'concurrent' && (
                  <Badge className="border-border bg-muted text-muted-foreground">Max {maxPerPair}/pair</Badge>
                )}
                <Badge className="border-border bg-muted text-muted-foreground">Max {maxOpenTrades} open</Badge>
              </div>

              <MetricsCards
                items={[
                  { label: 'Net return', value: formatPct(m.totalReturnPct), tone: m.totalReturnPct >= 0 ? 'up' : 'down' },
                  { label: 'Win rate', value: formatPct(m.winRatePct), tone: 'neutral' },
                  { label: 'Max drawdown', value: formatPct(m.maxDrawdownPct), tone: 'down' },
                  { label: 'Profit factor', value: formatNum(m.profitFactor, 2), tone: m.profitFactor >= 1 ? 'up' : 'down' },
                  { label: 'Net profit', value: formatUsd(m.netProfit), tone: m.netProfit >= 0 ? 'up' : 'down' },
                  { label: 'Trades', value: String(m.totalTrades), tone: 'neutral' },
                ]}
              />

              <Card>
                <CardHeader>
                  <CardTitle>Equity curve</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {formatUsd(result.startEquity)} → {formatUsd(result.finalEquity)}
                  </span>
                </CardHeader>
                <CardContent>
                  <EquityChart points={result.equityCurve} height={240} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Price action</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {primaryBars.length} bars · {strategy.interval} · {strategy.pair}
                  </span>
                </CardHeader>
                <CardContent>
                  <CandleChart bars={primaryBars} height={320} />
                </CardContent>
              </Card>

              <TradesTable trades={result.trades} title={`Simulated trades (${result.trades.length})`} />
            </>
          )}

          {strategies.length > 0 && (
            <p className={cn('text-xs text-muted-foreground')}>
              {strategies.length} saved strateg{strategies.length === 1 ? 'y' : 'ies'} — manage them on the
              Strategies page.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}