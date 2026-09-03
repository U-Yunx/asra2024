import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Check, ListChecks, Pause, Play, ShieldAlert, Sliders, Sparkles, Target, Timer, Wallet } from 'lucide-react'
import { DEFAULT_PAPER_BALANCE, usePaperAccount } from '../lib/trading/usePaperAccount'
import { useRobotPrefs, methodInterval, methodLabel, methodRiskDefaults } from '../lib/trading/robotPrefs'
import { useRobotRecorder } from '../lib/trading/useRobotRecorder'
import { autoTune } from '../lib/trading/autoTune'
import { aggressivenessLabel, useManualTune } from '../lib/trading/manualTune'
import { rankPairs, type RankedPair } from '../lib/trading/pairRanking'
import { fetchTimeSeries, useQuotes } from '../hooks/useMarketData'
import { useSelectedStrategy } from '../hooks/useSelectedStrategy'
import { useAuth } from '../hooks/useAuth'
import { useAccess, useBrokers, useProfile, useSubscriptions } from '../hooks/usePlatform'
import { acceptRisk } from '../lib/platform'
import { pipValueUsd, stopDistanceFromAtr, suggestPositionUnits } from '../lib/trading/risk'
import { equity } from '../lib/trading/engine'
import { INTERVALS, STRATEGY_META, intervalLabel } from '../lib/strategies'
import { WATCHLIST } from '../lib/watchlist'
import { fn as invokeEdge } from '../lib/functions'
import type { Bar, BrokerConnectionRow, Interval, StrategyConfig, TradingMethod, TunedResult } from '../lib/types'
import type { BrokerMode, RatesMap, AccountState, RobotConfig, RobotCycleInput } from '../lib/trading/types'
import { timeAgo, formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader, Select, Skeleton } from '../components/ui'
import { MarketStatus } from '../components/MarketStatus'
import { AccountSummary } from '../components/trading/AccountSummary'
import { PositionsTable } from '../components/trading/PositionsTable'
import { TradeJournal } from '../components/trading/TradeJournal'
import { RiskPanel } from '../components/trading/RiskPanel'
import { TradeForm } from '../components/trading/TradeForm'
import { ManualTunePanel } from '../components/trading/ManualTunePanel'
import { LiveChartPanel } from '../components/trading/LiveChartPanel'
import { RobotLivePrices } from '../components/trading/RobotLivePrices'

function strategyLabel(c: StrategyConfig): string {
  return `${STRATEGY_META[c.type].shortLabel} · ${intervalLabel(c.interval)}`
}

function ModeToggle({ mode, onChange }: { mode: BrokerMode; onChange: (m: BrokerMode) => void }) {
  const options: { value: BrokerMode; label: string; hint?: string }[] = [
    { value: 'paper', label: 'Paper' },
    { value: 'managed', label: 'Live (managed)' },
    { value: 'oanda', label: 'Live (OANDA)' },
    { value: 'mt', label: 'Live (MT4/5)' },
  ]
  return (
    <div className="flex flex-col items-end gap-1">
      <div
        className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1"
        role="group"
        aria-label="Trading mode"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={mode === o.value}
            className={cn(
              'h-8 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors duration-150',
              mode === o.value ? 'bg-accent text-black' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {mode === 'mt' && (
        <span className="text-xs text-muted-foreground">
          For real live MetaTrader trading, prefer <span className="text-accent">OANDA</span> or{' '}
          <span className="text-accent">managed</span> — MT needs the platform's MetaApi bridge configured.
        </span>
      )}
    </div>
  )
}

function MethodToggle({ method, onChange }: { method: TradingMethod; onChange: (m: TradingMethod) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1" role="group" aria-label="Trading method">
      {(['scalping', 'longterm'] as TradingMethod[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={method === m}
          title={m === 'scalping' ? 'Fast intervals, tight stops' : 'Slow intervals, wide stops'}
          className={cn(
            'h-8 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors duration-150',
            method === m ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {methodLabel(m)}
        </button>
      ))}
    </div>
  )
}

/** Live account summary pulled from the connected broker through its Edge Function. */
function LiveSummary({ fn, label }: { fn: 'broker-oanda' | 'broker-mt'; label: string }) {
  const [data, setData] = useState<{ balance: number; nav: number; openTrades: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      const { data, error } = await invokeEdge<{
        ok?: boolean
        account?: {
          balance?: string | number
          NAV?: string | number
          equity?: string | number
          openTradeCount?: string | number
          openPositions?: string | number
        }
        error?: string
      }>(fn, {
        body: { action: 'summary' },
        fallback: `Could not load your ${label} account.`,
      })
      if (!active) return
      setLoading(false)
      const d = data
      if (error || !d?.ok || !d.account) {
        setError(d?.error ?? error ?? `Could not load your ${label} account.`)
        return
      }
      const acc = d.account
      setData({
        balance: Number(acc.balance ?? 0),
        nav: Number(acc.NAV ?? acc.equity ?? acc.balance ?? 0),
        openTrades: Number(acc.openTradeCount ?? acc.openPositions ?? 0),
      })
    })()
    return () => {
      active = false
    }
  }, [fn, label])

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-56" />
          </div>
        </CardContent>
      </Card>
    )
  }
  if (error) {
    return (
      <Card>
        <CardContent>
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{label} balance</p>
            <p className="mt-1 text-2xl font-bold tnum">{formatUsd(data?.balance ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Equity</p>
            <p className="mt-1 text-2xl font-bold tnum">{formatUsd(data?.nav ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Open positions</p>
            <p className="mt-1 text-2xl font-bold tnum">{data?.openTrades ?? 0}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Live-mode banner: labels the connected broker account and warns about real money. */
function LiveBanner({ conn, label }: { conn: BrokerConnectionRow; label: string }) {
  const live = conn.account_type === 'live'
  return (
    <div
      className={
        live
          ? 'flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/10 p-4 sm:flex-row sm:items-center'
          : 'flex flex-col gap-3 rounded-xl border border-up/30 bg-up/10 p-4 sm:flex-row sm:items-center'
      }
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${live ? 'bg-amber/20 text-amber' : 'bg-up/15 text-up'}`}>
        <ShieldAlert className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1">
        <h2 className={`text-sm font-semibold ${live ? 'text-amber' : 'text-up'}`}>
          {live ? 'LIVE account — real money' : 'Practice (demo) account'}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {live
            ? `Orders the robot or the manual form sends are placed on your real ${label} account. Stops are enforced by the broker, and your risk limits still gate every entry.`
            : `Trades run on your ${label} practice account with virtual funds — safe to experiment. Switch to a live account on the Brokers page when you are ready.`}{' '}
          Account <span className="font-mono">{conn.account_id ?? '—'}</span> ·{' '}
          <Link to="/brokers" className={live ? 'text-amber hover:underline' : 'text-accent hover:underline'}>
            manage connection
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

/** Managed-live banner: the platform's own live ledger, no external broker token needed. */
function ManagedBanner() {
  return (
    <div
      className={
        'flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/10 p-4 sm:flex-row sm:items-center'
      }
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber/20 text-amber`}>
        <ShieldAlert className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1">
        <h2 className="text-sm font-semibold text-amber">Managed live account — money-style trading</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your positions run in real size on the platform's own ledger with the same risk rules, stops and journal as
          paper — but there is <span className="font-medium text-foreground">no external broker to connect</span> and
          no MetaApi token required. The account is yours and persists to your profile.
        </p>
      </div>
    </div>
  )
}

const DURATION_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Off (run until stopped)', value: null },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: '4 hours', value: 240 },
  { label: '8 hours', value: 480 },
  { label: '24 hours', value: 1440 },
]

function fmtCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function Trading() {
  const { user } = useAuth()
  const { profile, refresh: refreshProfile } = useProfile()
  const { subscriptions } = useSubscriptions(user?.id)
  const access = useAccess(profile, subscriptions)

  const {
    account,
    loading,
    mode,
    setBrokerMode,
    open,
    close,
    sync,
    runCycle,
    setRisk,
    closeRobotPositions,
    reset,
  } = usePaperAccount()
  const [strategy, updateStrategy] = useSelectedStrategy()
  const {
    prefs,
    setMethod,
    setDuration,
    setPairs,
    togglePair,
    setAutoPickPairs,
    setPairCount,
    setPerTradeTakeProfitPips,
    setPerTradeStopLossPips,
    setOverallMaxProfitUsd,
    setOverallMaxLossUsd,
  } = useRobotPrefs()
  // The robot trades every pair the user has ticked; default to the first two
  // so a brand-new user sees the robot working out of the box.
  const robotPairs = useMemo(
    () => (prefs.pairs.length > 0 ? prefs.pairs : WATCHLIST.slice(0, 2).map((p) => p.symbol)),
    [prefs.pairs],
  )
  // Pairs the robot actually scans each cycle: the full watchlist when auto-pick
  // is on, otherwise the explicitly selected pairs.
  const scanPairs = useMemo(
    () => (prefs.autoPickPairs ? WATCHLIST.map((p) => p.symbol) : robotPairs),
    [prefs.autoPickPairs, robotPairs],
  )
  // Live quotes stream over Realtime (the market-data Edge Function refreshes
  // priority symbols — the robot's pairs — first) with polling as a fallback.
  // The free tier keeps the paper robot and manual trading; the live/managed
  // robot still requires an active subscription.
  const { quotes, kind: marketKind, error: marketError } = useQuotes(15_000, scanPairs)
  const canRunRobot = access.hasAccess || (mode === 'paper' && access.paperTrading)
  const { tune, update: updateTune, applyPreset, reset: resetTune } = useManualTune()
  const { connections } = useBrokers(user?.id)
  const oandaConn = connections.find((c) => c.brokers?.slug === 'oanda')
  const mtConn = connections.find((c) => c.platform === 'mt4' || c.platform === 'mt5')
  // External-broker live (OANDA / MT) — managed live runs on the platform's own
  // ledger and needs no broker connection, so it never depends on these.
  const isBrokerLive = mode === 'oanda' || mode === 'mt'
  const liveConn = mode === 'oanda' ? oandaConn : mtConn
  const liveLabel = mode === 'oanda' ? 'OANDA' : 'MetaTrader'

  // Managed-live auto-trading requires accepting the risk disclaimer once
  // (stored on the profile). The robot refuses to auto-trade until it's done.
  const needsRiskAccept = mode === 'managed' && (profile?.risk_accepted ?? false) !== true

  const [seed, setSeed] = useState(DEFAULT_PAPER_BALANCE)
  const [robotLog, setRobotLog] = useState<string[]>([])
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [tuning, setTuning] = useState(false)
  const [tuned, setTuned] = useState<TunedResult | null>(null)
  const [showManualTune, setShowManualTune] = useState(false)
  const [tuneApplied, setTuneApplied] = useState(false)
  const runningRef = useRef(false)
  // Equity captured when the robot starts; the session guard compares current
  // equity against it to enforce the overall max profit / max loss limits.
  // Mirrored in state so the trading-progress panel can render the live
  // session P&L (a plain ref wouldn't trigger re-renders).
  const sessionStartRef = useRef<number | null>(null)
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  // Latest rates mirrored for the auto-run timer, which lives in an interval
  // closure and must not re-create itself on every quote tick.
  const ratesRef = useRef<RatesMap>({})

  const rates = useMemo<RatesMap>(() => {
    const r: RatesMap = {}
    for (const q of quotes ?? []) if (q.price != null) r[q.symbol] = q.price
    ratesRef.current = r
    return r
  }, [quotes])

  // Stopping the robot also flattens every position it opened — a stopped
  // robot never leaves open trades on the book. Shared by the manual Stop
  // button and the auto-run expiry.
  const stopRobotAndFlatten = () => {
    if (!account) return
    const { closed } = closeRobotPositions(ratesRef.current)
    setRisk({ autoTrade: false })
    setEndsAt(null)
    setRemaining(null)
    setRobotLog((prev) =>
      [
        closed > 0
          ? `Robot stopped — ${closed} robot position${closed === 1 ? '' : 's'} closed at market. Manual positions are untouched.`
          : 'Robot stopped — no open robot positions to close.',
        ...prev,
      ].slice(0, 8),
    )
  }

  // Stop-loss / take-profit are enforced on every quote tick.
  useEffect(() => {
    if (!account || Object.keys(rates).length === 0) return
    void sync(rates)
  }, [rates, account, sync])

  const autoTrade = (account?.risk.autoTrade ?? false) && canRunRobot

  // Values backing the "Trading progress" panel: auto-run countdown and
  // session P&L vs the max-profit / max-loss limits.
  const sessionPnl =
    account && autoTrade && sessionStart != null ? equity(account, rates) - sessionStart : null
  const runTotalSecs = prefs.durationMinutes != null ? prefs.durationMinutes * 60 : 0
  const runPct =
    runTotalSecs > 0 && remaining != null
      ? Math.min(100, Math.max(0, ((runTotalSecs - remaining) / runTotalSecs) * 100))
      : 0
  const profitPct =
    sessionPnl != null && prefs.overallMaxProfitUsd > 0
      ? Math.min(100, Math.max(0, (Math.max(0, sessionPnl) / prefs.overallMaxProfitUsd) * 100))
      : 0
  const lossPct =
    sessionPnl != null && prefs.overallMaxLossUsd > 0
      ? Math.min(100, Math.max(0, (Math.max(0, -sessionPnl) / prefs.overallMaxLossUsd) * 100))
      : 0

  // Record robot runs as sessions + equity history while the robot trades.
  useRobotRecorder({
    user,
    account,
    running: autoTrade,
    strategyLabel: `Robot · ${robotPairs.join(', ')}`,
    method: prefs.method,
    rates,
  })

  // Auto-run timer: stops the robot when the chosen duration elapses.
  useEffect(() => {
    if (autoTrade && prefs.durationMinutes) {
      setEndsAt(Date.now() + prefs.durationMinutes * 60_000)
    } else if (!(account?.risk.autoTrade ?? false)) {
      setEndsAt(null)
      setRemaining(null)
    }
  }, [autoTrade, prefs.durationMinutes, account?.risk.autoTrade])

  useEffect(() => {
    if (!endsAt) return
    const tick = () => {
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) {
        const closed = closeRobotPositions(ratesRef.current).closed
        setRisk({ autoTrade: false })
        setRobotLog((prev) =>
          [
            closed > 0
              ? `Robot auto-run finished — trading paused, ${closed} robot position${closed === 1 ? '' : 's'} closed at market.`
              : 'Robot auto-run finished — trading paused, no open robot positions to close.',
            ...prev,
          ].slice(0, 8),
        )
        setEndsAt(null)
        setRemaining(null)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [endsAt, setRisk, closeRobotPositions])

  /**
   * Session profit / loss guard. While the robot runs it tracks the equity
   * change since the run started and stops + flattens everything as soon as the
   * overall max profit or max loss (USD) is reached. Limits of 0 are disabled.
   */
  useEffect(() => {
    if (!account || !autoTrade) {
      sessionStartRef.current = null
      setSessionStart(null)
      return
    }
    const currentEquity = equity(account, rates)
    if (sessionStartRef.current == null) {
      sessionStartRef.current = currentEquity
      setSessionStart(currentEquity)
      return
    }
    const pnl = currentEquity - sessionStartRef.current
    const maxLoss = prefs.overallMaxLossUsd > 0 && pnl <= -prefs.overallMaxLossUsd
    const maxProfit = prefs.overallMaxProfitUsd > 0 && pnl >= prefs.overallMaxProfitUsd
    if (!maxLoss && !maxProfit) return
    setRisk({ autoTrade: false })
    const closed = closeRobotPositions(rates).closed
    sessionStartRef.current = null
    setSessionStart(null)
    setRobotLog((prev) =>
      [
        maxLoss
          ? `Session guard hit the overall max loss (${formatUsd(prefs.overallMaxLossUsd)}) at ${formatUsd(pnl)} — robot stopped, ${closed} robot position${closed === 1 ? '' : 's'} closed.`
          : `Session guard hit the overall max profit (${formatUsd(prefs.overallMaxProfitUsd)}) at ${formatUsd(pnl)} — robot stopped, ${closed} robot position${closed === 1 ? '' : 's'} closed.`,
        ...prev,
      ].slice(0, 8),
    )
  }, [account, autoTrade, rates, prefs.overallMaxLossUsd, prefs.overallMaxProfitUsd, closeRobotPositions, setRisk])

  /**
   * The multi-pair / multi-strategy robot. On every quote tick it fetches fresh
   * bars for the pairs in scope, evaluates ALL strategies on each pair, and
   * ranks every actionable setup by probability-of-profit (live signal strength
   * + the backtested edge of that same strategy). It opens the strongest setups
   * first — up to the account's max-open-positions limit, one position per pair.
   *
   * In "best analysis method" (auto-pick) mode it scans the whole watchlist and
   * trades only the top `pairCount` ranked pairs; otherwise it only considers
   * the pairs the user ticked.
   */
  useEffect(() => {
    if (!account || !autoTrade || marketKind !== 'ok') return
    const interval = methodInterval(prefs.method)
    const scanSymbols = prefs.autoPickPairs ? WATCHLIST.map((p) => p.symbol) : robotPairs
    let cancelled = false
    void (async () => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        // Fetch fresh bars for every candidate pair in parallel.
        const barsBySymbol: Record<string, Bar[]> = {}
        await Promise.all(
          scanSymbols.map(async (symbol) => {
            const res = await fetchTimeSeries({ symbol, interval, outputsize: 200 })
            if (cancelled || res.kind !== 'ok' || !res.data || res.data.length < 2) return
            barsBySymbol[symbol] = res.data
          }),
        )
        if (cancelled) return

        // Score + rank every pair. Auto-pick keeps only the top-ranked few.
        const ranked = rankPairs(barsBySymbol, interval)
        const targets: RankedPair[] = prefs.autoPickPairs ? ranked.slice(0, prefs.pairCount) : ranked
        if (prefs.autoPickPairs && targets.length > 0) {
          setRobotLog((prev) =>
            [
              `Best analysis method picked ${targets.length} pair${targets.length === 1 ? '' : 's'}: ${targets
                .map((t) => `${t.symbol} (${Math.round(t.score)}%)`)
                .join(', ')}.`,
              ...prev,
            ].slice(0, 8),
          )
        }

        const cycleInputs: RobotCycleInput[] = []
        for (const target of targets) {
          if (cancelled) return
          // Build one cycle input per qualifying pair — runCycle (the engine's
          // runRobotCycle for paper, the throttled live loop for brokers)
          // enforces per-pair + global caps and isolates per-pair failures.
          const price = rates[target.symbol]
          if (price == null) continue
          const bars = barsBySymbol[target.symbol]
          if (!bars || !target.best) continue

          // Per-trade TP/SL overrides (in pips) beat the risk-based defaults.
          const atrStop = stopDistanceFromAtr(bars, target.symbol)
          const stopPips =
            prefs.perTradeStopLossPips > 0
              ? prefs.perTradeStopLossPips
              : atrStop > 0
                ? Math.max(account.risk.defaultStopPips, atrStop)
                : account.risk.defaultStopPips
          const takeProfitPips =
            prefs.perTradeTakeProfitPips > 0
              ? prefs.perTradeTakeProfitPips
              : Math.round(stopPips * account.risk.takeProfitRatio)
          const pipValue = pipValueUsd(target.symbol, rates)
          if (pipValue == null) continue
          const units = suggestPositionUnits({
            equity: equity(account, rates),
            riskPct: account.risk.riskPerTradePct,
            stopPips,
            pipValue,
          })
          if (units <= 0) continue

          // Manual tune scales position size relative to the risk-based default.
          const scaledUnits = Math.round(units * tune.sizeMultiplier)
          if (scaledUnits <= 0) continue

          const label = `${STRATEGY_META[target.best.type].shortLabel} · ${intervalLabel(interval)}`
          cycleInputs.push({
            symbol: target.symbol,
            signal: target.best.signal,
            price,
            rates,
            strategy: label,
            stopPips,
            takeProfitPips,
            units: scaledUnits,
          })
        }
        if (!cancelled && cycleInputs.length > 0) {
          const config: RobotConfig = {
            pairs: scanPairs,
            tradeMode: prefs.tradeMode,
            maxPerPair: prefs.maxPerPair,
            maxOpenTrades: prefs.maxOpenTrades,
          }
          const { events } = await runCycle(cycleInputs, config)
          if (events.length) {
            setRobotLog((prev) => [...events, ...prev].slice(0, 8))
            setLastRun(Date.now())
          }
        }
      } finally {
        runningRef.current = false
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    account,
    autoTrade,
    robotPairs,
    prefs.method,
    prefs.autoPickPairs,
    prefs.pairCount,
    prefs.perTradeStopLossPips,
    prefs.perTradeTakeProfitPips,
    prefs.tradeMode,
    prefs.maxPerPair,
    prefs.maxOpenTrades,
    rates,
    marketKind,
    runCycle,
    tune.sizeMultiplier,
  ])

  const handleClose = (id: string) => {
    if (!account) return
    const pos = account.positions.find((p) => p.id === id)
    if (!pos) return
    const price = rates[pos.symbol] ?? pos.entryPrice
    void close(id, 'manual', price, rates)
  }

  const applyMethod = (m: TradingMethod) => {
    setMethod(m)
    updateStrategy({ ...strategy, interval: methodInterval(m) })
    setRisk(methodRiskDefaults(m))
    setTuned(null)
    setRobotLog((prev) =>
      [
        `Method set to ${methodLabel(m)} — interval ${intervalLabel(methodInterval(m))}, stops and risk adjusted.`,
        ...prev,
      ].slice(0, 8),
    )
  }

  const runTune = async () => {
    setTuning(true)
    setTuned(null)
    const res = await fetchTimeSeries({
      symbol: strategy.pair,
      interval: strategy.interval,
      outputsize: 300,
    })
    setTuning(false)
    if (res.kind !== 'ok' || !res.data || res.data.length < 30) {
      setRobotLog((prev) => ['Auto-tune: not enough price data right now — try again shortly.', ...prev].slice(0, 8))
      return
    }
    const result = autoTune(res.data, strategy.type, strategy.params)
    if (!result) {
      setRobotLog((prev) => ['Auto-tune: no parameter set beat the current one.', ...prev].slice(0, 8))
      return
    }
    updateStrategy({ ...strategy, params: result.params })
    setTuned(result)
    setRobotLog((prev) =>
      [`Auto-tune picked ${STRATEGY_META[strategy.type].shortLabel} parameters (${result.profitFactor.toFixed(2)} profit factor).`, ...prev].slice(0, 8),
    )
  }

  const applyManualTune = () => {
    setRisk({
      riskPerTradePct: tune.riskPerTradePct,
      takeProfitRatio: tune.takeProfitRatio,
      maxOpenPositions: tune.maxOpenPositions,
      maxDailyLossPct: tune.maxDailyLossPct,
    })
    setTuneApplied(true)
    setTuned(null)
    setRobotLog((prev) =>
      [
        `Manual tune applied — ${aggressivenessLabel(tune.aggressiveness)} profile, ~${tune.targetProfitPct}% target per run, ${tune.sizeMultiplier}× position size.`,
        ...prev,
      ].slice(0, 8),
    )
    setShowManualTune(false)
  }

  const guardedSetRisk = (patch: Parameters<typeof setRisk>[0]) => {
    if (patch.autoTrade === true && needsRiskAccept) {
      setRobotLog((prev) =>
        ['Accept the risk disclaimer first — managed live auto-trading stays locked until you do.', ...prev].slice(0, 8),
      )
      return
    }
    if (patch.autoTrade === true && !canRunRobot) return
    if (patch.autoTrade === true && mode !== 'paper') {
      let msg: string
      if (mode === 'managed') {
        msg = 'You are about to auto-trade on your MANAGED live account — the platform\'s real-size ledger, no external broker. Continue?'
      } else {
        const live = liveConn?.account_type === 'live'
        msg = live
          ? `WARNING: You are about to auto-trade on your LIVE ${liveLabel} account with REAL money. Every signal will place a real order. Continue?`
          : `You are about to auto-trade on your ${liveLabel} practice (demo) account. No real money moves. Continue?`
      }
      if (!window.confirm(msg)) return
    }
    setRisk(patch)
  }

  const acceptRiskNow = async () => {
    if (!user) return
    const err = await acceptRisk(user.id)
    if (err) {
      setRobotLog((prev) => ["We couldn't save your risk acceptance — try again.", ...prev].slice(0, 8))
      return
    }
    await refreshProfile()
    setRobotLog((prev) => ['Risk disclaimer accepted — managed live auto-trading is unlocked.', ...prev].slice(0, 8))
  }

  const riskGate =
    needsRiskAccept && mode === 'managed' ? (
      <Card className="border-amber/40">
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber/20 text-amber">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-amber">Accept the risk disclaimer to auto-trade live</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Your managed live account trades in real size. Before the robot can auto-trade it, confirm you
                understand the risks — you'll only be asked once.
              </p>
            </div>
            <Button size="sm" onClick={() => void acceptRiskNow()}>
              Accept risk &amp; continue
            </Button>
          </div>
        </CardContent>
      </Card>
    ) : null

  const marketAlert =
    marketKind !== 'ok' ? (
      <p role="alert" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {marketError} The robot won't open or close anything until prices are available again.
      </p>
    ) : null

  // Shared robot control card — used by both paper and live modes.
  const robotCard = (
    <Card>
      <CardHeader>
        <CardTitle>Robot</CardTitle>
        <div className="flex items-center gap-2">
          {remaining != null && endsAt && (
            <Badge className="border-amber/40 bg-amber/10 text-amber">
              <Timer className="h-3.5 w-3.5" aria-hidden="true" />
              {fmtCountdown(remaining)} left
            </Badge>
          )}
          <Badge className={autoTrade ? 'border-up/30 bg-up/15 text-up' : 'border-border bg-muted text-muted-foreground'}>
            {autoTrade ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
            {autoTrade ? 'Active' : 'Standby'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          {/* Start / stop */}
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {autoTrade ? 'Robot is live — trading the strongest setups' : 'Robot is standing by'}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {autoTrade
                  ? `Scanning ${robotPairs.length} pair${robotPairs.length === 1 ? '' : 's'} · every strategy evaluated on each · one position per pair, strongest setup first.`
                  : 'Start the robot to auto-trade the strongest signal across your selected pairs — always risk-sized with a stop-loss.'}
              </p>
            </div>
            <Button
              variant={autoTrade ? 'danger' : 'primary'}
              onClick={() => (autoTrade ? stopRobotAndFlatten() : guardedSetRisk({ autoTrade: true }))}
              disabled={!canRunRobot}
              className="shrink-0"
            >
              {autoTrade ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {autoTrade ? 'Stop robot' : 'Start robot'}
            </Button>
          </div>

          {/* Watchlist, trade mode and per-pair open/cap status */}
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                Watchlist · {prefs.tradeMode === 'concurrent' ? 'Concurrent' : 'Sequential'}
              </p>
              <Badge className="border-border bg-muted text-muted-foreground">
                {scanPairs.length} pair{scanPairs.length === 1 ? '' : 's'} · {prefs.autoPickPairs ? 'auto-picked' : 'manual'}
              </Badge>
              {prefs.tradeMode === 'concurrent' && (
                <Badge className="border-accent/40 bg-accent/10 text-accent">Max {prefs.maxPerPair}/pair</Badge>
              )}
              <Badge className="border-border bg-muted text-muted-foreground">
                Max {prefs.maxOpenTrades > 0 ? prefs.maxOpenTrades : 'unlimited'} total
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {scanPairs.map((sym) => {
                const openCount = account?.positions.filter((p) => p.symbol === sym).length ?? 0
                const cap = prefs.tradeMode === 'concurrent' ? prefs.maxPerPair : 1
                const atCap = openCount >= cap
                return (
                  <Badge
                    key={sym}
                    className={cn(
                      atCap
                        ? 'border-amber/40 bg-amber/10 text-amber'
                        : 'border-border bg-muted text-muted-foreground',
                    )}
                  >
                    {sym} {openCount}/{cap} open
                  </Badge>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {prefs.tradeMode === 'concurrent'
                ? 'Concurrent mode can hold multiple positions per pair up to the per-pair cap.'
                : 'Sequential mode holds at most one position per pair until it closes.'}
            </p>
          </div>

          {/* Trading progress + live prices for the robot's pairs */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
                Trading progress
              </p>
              {autoTrade ? (
                <div className="space-y-3">
                  {runTotalSecs > 0 && (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Auto-run</span>
                        <span className="font-mono tnum text-foreground">
                          {Math.round(runPct)}% done · {remaining != null ? `${fmtCountdown(remaining)} left` : '—'}
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(runPct)}
                        aria-label="Auto-run progress"
                        className="h-2 overflow-hidden rounded-full bg-muted/60"
                      >
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-500"
                          style={{ width: `${runPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {sessionPnl != null && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Session P&amp;L</span>
                        <span className={cn('font-mono tnum font-semibold', sessionPnl >= 0 ? 'text-up' : 'text-down')}>
                          {formatUsd(sessionPnl)}
                        </span>
                      </div>
                      {prefs.overallMaxProfitUsd > 0 && (
                        <div>
                          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>Profit target</span>
                            <span className="font-mono tnum">
                              {formatUsd(Math.max(0, sessionPnl))} / {formatUsd(prefs.overallMaxProfitUsd)}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                            <div
                              className="h-full rounded-full bg-up transition-[width] duration-500"
                              style={{ width: `${profitPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {prefs.overallMaxLossUsd > 0 && (
                        <div>
                          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>Loss limit</span>
                            <span className="font-mono tnum">
                              {formatUsd(Math.max(0, -sessionPnl))} / {formatUsd(prefs.overallMaxLossUsd)}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                            <div
                              className="h-full rounded-full bg-down transition-[width] duration-500"
                              style={{ width: `${lossPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {runTotalSecs <= 0 && sessionPnl == null && (
                    <p className="text-sm text-muted-foreground">
                      Robot is trading — its run countdown and session P&amp;L show here as prices update.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Start the robot to watch its auto-run countdown and session P&amp;L against your profit and loss
                  limits in real time.
                </p>
              )}
            </div>
            <RobotLivePrices pairs={scanPairs} />
          </div>

          {/* Multi-pair selector */}
          <div>
            <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Pairs to trade · {robotPairs.length} selected</span>
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPairs(WATCHLIST.map((p) => p.symbol))}
                  disabled={robotPairs.length === WATCHLIST.length}
                  className="cursor-pointer rounded border border-border bg-secondary/40 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setPairs([])}
                  disabled={robotPairs.length === 0}
                  className="cursor-pointer rounded border border-border bg-secondary/40 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              </span>
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Pairs the robot trades">
              {WATCHLIST.map((p) => {
                const on = robotPairs.includes(p.symbol)
                return (
                  <button
                    key={p.symbol}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePair(p.symbol)}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors duration-150',
                      on
                        ? 'border-accent/50 bg-accent/15 text-accent'
                        : 'border-border bg-secondary/40 text-muted-foreground hover:border-accent/40 hover:text-foreground',
                    )}
                  >
                    {on && <Check className="h-3 w-3" aria-hidden="true" />}
                    {p.symbol}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              The robot picks the best strategy for each pair automatically and holds one position per pair. Add pairs
              to spread its attention, or remove them to focus it.
            </p>
          </div>

          {/* Best analysis method (auto-pick) — rank every pair, trade the top ones */}
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Best analysis method (auto-pick)</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Scan the whole watchlist and trade only the highest-probability pairs — live signal strength
                  combined with each strategy's backtested edge.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.autoPickPairs}
                aria-label="Toggle auto-pick pairs"
                onClick={() => setAutoPickPairs(!prefs.autoPickPairs)}
                className={cn(
                  'relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-150',
                  prefs.autoPickPairs ? 'border-accent bg-accent' : 'border-border bg-secondary',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-foreground transition-transform duration-150',
                    prefs.autoPickPairs ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                />
              </button>
            </div>
            {prefs.autoPickPairs && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  <ListChecks className="h-4 w-4 text-accent" aria-hidden="true" />
                  Pairs to trade
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Fewer pairs"
                    onClick={() => setPairCount(Math.max(1, prefs.pairCount - 1))}
                    disabled={prefs.pairCount <= 1}
                  >
                    −
                  </Button>
                  <span className="w-8 text-center text-sm font-semibold tnum">{prefs.pairCount}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="More pairs"
                    onClick={() => setPairCount(Math.min(WATCHLIST.length, prefs.pairCount + 1))}
                    disabled={prefs.pairCount >= WATCHLIST.length}
                  >
                    +
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  Robot trades the top {prefs.pairCount} of {WATCHLIST.length} pairs by probability of profit.
                </span>
              </div>
            )}
          </div>

          {/* Per-trade TP/SL overrides + session profit/loss limits */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Target className="h-4 w-4 text-accent" aria-hidden="true" />
                Per-trade stops (pips)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="per-trade-tp">
                    Take profit
                  </label>
                  <Input
                    id="per-trade-tp"
                    type="number"
                    min={0}
                    value={prefs.perTradeTakeProfitPips > 0 ? prefs.perTradeTakeProfitPips : ''}
                    placeholder="Auto"
                    onChange={(e) => setPerTradeTakeProfitPips(Math.max(0, Number(e.target.value)))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="per-trade-sl">
                    Stop loss
                  </label>
                  <Input
                    id="per-trade-sl"
                    type="number"
                    min={0}
                    value={prefs.perTradeStopLossPips > 0 ? prefs.perTradeStopLossPips : ''}
                    placeholder="Auto"
                    onChange={(e) => setPerTradeStopLossPips(Math.max(0, Number(e.target.value)))}
                  />
                </div>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Leave 0 to keep the strategy's risk-based stops.</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ShieldAlert className="h-4 w-4 text-amber" aria-hidden="true" />
                Session limits (USD)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="session-profit">
                    Max profit
                  </label>
                  <Input
                    id="session-profit"
                    type="number"
                    min={0}
                    value={prefs.overallMaxProfitUsd > 0 ? prefs.overallMaxProfitUsd : ''}
                    placeholder="Off"
                    onChange={(e) => setOverallMaxProfitUsd(Math.max(0, Number(e.target.value)))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="session-loss">
                    Max loss
                  </label>
                  <Input
                    id="session-loss"
                    type="number"
                    min={0}
                    value={prefs.overallMaxLossUsd > 0 ? prefs.overallMaxLossUsd : ''}
                    placeholder="Off"
                    onChange={(e) => setOverallMaxLossUsd(Math.max(0, Number(e.target.value)))}
                  />
                </div>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Robot stops and closes everything once a run reaches either limit.
              </p>
            </div>
          </div>

          {/* Strategy profile, chart timeframe, auto-run duration */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2">
              <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Strategy profile</p>
                <p className="truncate text-sm font-medium text-foreground">{strategyLabel(strategy)}</p>
              </div>
            </div>
            <Select
              label="Chart interval"
              value={strategy.interval}
              onChange={(e) => updateStrategy({ ...strategy, interval: e.target.value as Interval })}
            >
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </Select>
            <Select
              label="Auto-run duration"
              value={String(prefs.durationMinutes ?? 0)}
              onChange={(e) => setDuration(e.target.value === '0' ? null : Number(e.target.value))}
            >
              {DURATION_OPTIONS.map((o) => (
                <option key={String(o.value)} value={String(o.value ?? 0)}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="text-sm text-muted-foreground">
            {lastRun ? <span>Last run {timeAgo(lastRun)}</span> : <span>Waiting for a signal…</span>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => void runTune()} loading={tuning} disabled={!canRunRobot}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Auto-tune strategy
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowManualTune((v) => !v)} disabled={!canRunRobot}>
            <Sliders className="h-4 w-4" aria-hidden="true" />
            Manual tune
          </Button>
          {tuned && (
            <p className="text-xs text-muted-foreground">
              Tuned {STRATEGY_META[strategy.type].shortLabel}: profit factor{' '}
              <span className="font-mono text-foreground">{tuned.profitFactor.toFixed(2)}</span> ·{' '}
              {tuned.totalReturnPct.toFixed(1)}% return · {tuned.trades} trades on {strategy.interval}.
            </p>
          )}
          {!canRunRobot && (
            <span className="text-xs text-muted-foreground">
              Auto-tune unlocks with a package —{' '}
              <Link to="/packages" className="text-accent hover:underline">
                see packages
              </Link>
              .
            </span>
          )}
        </div>

        {showManualTune && (
          <div className="mt-4">
            <ManualTunePanel
              tune={tune}
              onUpdate={updateTune}
              onApplyPreset={applyPreset}
              onReset={resetTune}
              onApply={applyManualTune}
              applied={tuneApplied}
            />
          </div>
        )}

        {robotLog.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {robotLog.map((e, i) => (
              <li key={`${i}-${e}`} className="rounded-md bg-muted/40 px-3 py-1.5 font-mono text-xs tnum">
                {e}
              </li>
            ))}
          </ul>
        )}
        </div>
      </CardContent>
    </Card>
  )

  // Full account body — shared by the paper flow and the live mirror.
  const accountBody = (acc: AccountState) => (
    <>
      {riskGate}
      {marketAlert}
      <AccountSummary account={acc} rates={rates} />
      {robotCard}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <RiskPanel
          risk={acc.risk}
          onChange={guardedSetRisk}
          onReset={() => reset(acc.initialBalance)}
          isLive={mode !== 'paper'}
        />
        <div className="space-y-6 lg:col-span-2">
          <LiveChartPanel initialSymbol={strategy.pair} initialInterval={strategy.interval} />
          <TradeForm account={acc} rates={rates} onOpen={open} />
        </div>
      </div>
      <PositionsTable
        account={acc}
        rates={rates}
        onClose={handleClose}
        robotCaps={{
          tradeMode: prefs.tradeMode,
          maxPerPair: prefs.maxPerPair,
          maxOpenTrades: prefs.maxOpenTrades,
        }}
      />
      <TradeJournal trades={acc.trades} />
    </>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trading robot"
        description={
          <>
            Every trade is sized to your risk, always carries a stop-loss, and lands in your journal. Pick a method
            (scalping or long-term), let the robot run for a set duration, and auto-tune your strategy against
            recent prices.
          </>
        }
        actions={
          <>
            <MethodToggle method={prefs.method} onChange={applyMethod} />
            <ModeToggle mode={mode} onChange={setBrokerMode} />
          </>
        }
      />

      <MarketStatus quotes={quotes} />

      {!canRunRobot && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold">
                  {user ? 'Your free trial or subscription has ended' : 'Sign up for 30 minutes of robot access free'}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {user
                    ? 'Pick a package to keep the auto-trading robot running with risk limits, auto-tune and method presets.'
                    : 'Create an account and get full robot access for 30 minutes — no card required. Manual paper trading stays available below.'}
                </p>
              </div>
              <Link to="/packages">
                <Button size="sm">{user ? 'View packages' : 'Start free trial'}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {isBrokerLive ? (
        !liveConn ? (
          <Card>
            <CardContent>
              <div className="flex flex-col items-start gap-4 py-2 sm:flex-row sm:items-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <ShieldAlert className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Connect a broker to go live</h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Add your {liveLabel} account on the Brokers page — credentials are verified and stored
                    securely, never in the browser. Then come back here to see your live account.
                  </p>
                </div>
                <Link to="/brokers" className="shrink-0">
                  <Button size="sm">Connect broker</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <LiveBanner conn={liveConn} label={liveLabel} />
            <LiveSummary fn={mode === 'oanda' ? 'broker-oanda' : 'broker-mt'} label={liveLabel} />
            {account ? (
              accountBody(account)
            ) : loading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : null}
          </>
        )
      ) : account ? (
        mode === 'managed' ? (
          <>
            <ManagedBanner />
            {accountBody(account)}
          </>
        ) : (
          accountBody(account)
        )
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Wallet className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">
                  {mode === 'managed' ? 'Start your managed live account' : 'Start your paper account'}
                </h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {mode === 'managed'
                    ? 'Open a money-style live ledger on the platform — real-size positions, no external broker and no MetaApi token needed. The robot sizes every position from your risk settings, always sets a stop-loss, and records everything in your journal.'
                    : 'Trade with simulated money. The robot sizes every position from your risk settings, always sets a stop-loss, and records everything in your journal. No sign-in required — sign in to back it up to your account and unlock the auto-trading robot.'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-end">
                <Input
                  label="Starting balance (USD)"
                  type="number"
                  min={100}
                  step={100}
                  value={seed}
                  onChange={(e) => setSeed(Math.max(100, Number(e.target.value) || 100))}
                />
                <Button
                  onClick={() => {
                    reset(seed)
                    if (mode === 'managed') setBrokerMode('managed')
                  }}
                >
                  {mode === 'managed' ? 'Create managed live account' : 'Create paper account'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}