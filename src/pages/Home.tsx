/**
 * Home — the public landing page shown to visitors. Hero, live watchlist
 * snapshot, the four product pillars, live user stats and a CTA to sign up.
 */
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Bot,
  LineChart,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { usePublicUserStats } from '../hooks/usePlatform'
import { useQuotes } from '../hooks/useMarketData'
import { WATCHLIST } from '../lib/watchlist'
import { formatChange, formatPrice } from '../lib/format'
import { cn } from '../lib/cn'
import { Button } from '../components/ui'

const PILLARS = [
  {
    icon: Bot,
    title: 'Robot trading',
    desc: 'Run fully automated strategies on a paper account first, then connect a real broker when you are ready.',
    gradient: 'from-trading/30 to-trading/5 border-trading/30',
  },
  {
    icon: Target,
    title: 'Auto-tune & backtest',
    desc: 'Stress-test any strategy against historical data and let the optimizer pick your best parameters.',
    gradient: 'from-tune/30 to-tune/5 border-tune/30',
  },
  {
    icon: LineChart,
    title: 'Live signals',
    desc: 'Real-time watchlist quotes and indicator-driven signals across forex and crypto pairs.',
    gradient: 'from-run/30 to-run/5 border-run/30',
  },
  {
    icon: ShieldCheck,
    title: 'Risk first',
    desc: 'Per-trade risk limits, trailing stops and daily loss caps protect your balance automatically.',
    gradient: 'from-pick/30 to-pick/5 border-pick/30',
  },
]

export function Home() {
  const { user } = useAuth()
  const { stats } = usePublicUserStats()
  const { quotes } = useQuotes()

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      {/* Hero */}
      <section className="text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          AI-assisted trading, risk-first by design
        </div>
        <h1 className="mx-auto max-w-3xl font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Trade markets with a robot that respects your{' '}
          <span className="text-accent">risk limits</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          ANA24 runs proven strategies on a free paper account, backtests them against history, and
          streams live signals across forex and crypto — then connects to your real broker only when
          you say so.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to={user ? '/trading' : '/auth'}>
            <Button size="lg">
              {user ? 'Open trading robot' : 'Start free paper trading'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
          <Link to="/packages">
            <Button variant="secondary" size="lg">
              See packages
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Traders" value={stats.registered.toLocaleString()} />
          <Stat label="Active 24h" value={stats.active_24h.toLocaleString()} />
          <Stat label="Active 7d" value={stats.active_7d.toLocaleString()} />
          <Stat label="Active 30d" value={stats.active_30d.toLocaleString()} />
        </div>
      </section>

      {/* Live watchlist snapshot */}
      <section className="mt-14">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">Live markets</h2>
          <Link to="/markets" className="flex items-center gap-1 text-sm text-accent hover:underline">
            All pairs <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {WATCHLIST.slice(0, 6).map((p) => {
            const q = quotes?.find((x) => x.symbol === p.symbol)
            const change = q?.percent_change ?? q?.change ?? 0
            return (
              <div
                key={p.symbol}
                className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{p.symbol}</p>
                  <p className="text-xs text-muted-foreground">{p.name}</p>
                </div>
                <div className="text-right">
                  <p className="tnum font-mono text-sm">{formatPrice(q?.price)}</p>
                  <p className={cn('tnum font-mono text-xs', change < 0 ? 'text-down' : 'text-up')}>
                    {formatChange(change)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Pillars */}
      <section className="mt-16">
        <h2 className="mb-6 text-center font-heading text-2xl font-bold text-foreground">
          Everything you need to trade smarter
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <div key={p.title} className={cn('rounded-2xl border bg-gradient-to-b p-6', p.gradient)}>
              <p.icon className="mb-3 h-6 w-6 text-accent" aria-hidden="true" />
              <h3 className="font-heading text-lg font-semibold text-foreground">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mt-16 rounded-2xl border border-border bg-gradient-to-r from-primary/10 via-transparent to-primary/10 p-8 text-center">
        <BarChart3 className="mx-auto mb-4 h-8 w-8 text-accent" aria-hidden="true" />
        <h2 className="font-heading text-2xl font-bold text-foreground">Start with a free paper account</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          No card, no risk. Run one robot on paper trading today, backtest your ideas, and upgrade
          only when you're ready for live markets.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link to={user ? '/trading' : '/auth'}>
            <Button size="lg">
              <Users className="h-4 w-4" aria-hidden="true" />
              Create free account
            </Button>
          </Link>
          <Link to="/help">
            <Button variant="ghost" size="lg">
              Read the docs
            </Button>
          </Link>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 px-4 py-3">
      <p className="tnum font-mono text-xl font-bold text-foreground">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}