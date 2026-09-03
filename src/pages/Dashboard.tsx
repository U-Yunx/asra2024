/**
 * Dashboard — the signed-in landing page. Quick access to the trading robot,
 * a snapshot of the paper account, your access status and the live watchlist.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, LineChart, Play, Wallet } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAccess, useAddonPurchases, useProfile, useSubscriptions } from '../hooks/usePlatform'
import { usePaperAccount } from '../lib/trading/usePaperAccount'
import { useQuotes } from '../hooks/useMarketData'
import { equity } from '../lib/trading/engine'
import { formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '../components/ui'
import { QuoteTable } from '../components/QuoteTable'

function AccessBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    admin: { label: 'Admin', cls: 'border-accent/40 bg-accent/15 text-accent' },
    active: { label: 'Subscribed', cls: 'border-up/40 bg-up/15 text-up' },
    trial: { label: 'Trial', cls: 'border-amber/40 bg-amber/15 text-amber' },
    expired: { label: 'Expired', cls: 'border-destructive/40 bg-destructive/15 text-destructive' },
    none: { label: 'No access', cls: 'border-border bg-muted text-muted-foreground' },
  }
  const m = map[status] ?? map.none
  return <Badge className={m.cls}>{m.label}</Badge>
}

export function Dashboard() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { subscriptions } = useSubscriptions(user?.id)
  const { purchases } = useAddonPurchases(user?.id)
  const { account, loading: accLoading, mode } = usePaperAccount()
  const { quotes, loading: quotesLoading } = useQuotes()
  const access = useAccess(profile, subscriptions, purchases)

  const balance = account?.balance
  const eq = account ? equity(account, {}) : 0
  const startDate = account?.createdAt

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back{profile?.display_name ? `, ${profile.display_name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'paper' ? 'Paper trading account' : `${mode} (live) account`} · {startDate ? `opened ${startDate}` : 'ready'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccessBadge status={access.status} />
          <Link to="/trading">
            <Button>
              <Play className="h-4 w-4" aria-hidden="true" />
              Open trading robot
            </Button>
          </Link>
        </div>
      </div>

      {/* Paper account snapshot */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-accent" aria-hidden="true" />
            Paper account
          </CardTitle>
          <Link to="/trading" className="flex items-center gap-1 text-sm text-accent hover:underline">
            Details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardContent>
          {accLoading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Balance" value={balance != null ? formatUsd(balance) : '—'} />
              <Stat label="Equity" value={formatUsd(eq)} />
              <Stat label="Open positions" value={String(account?.positions.length ?? 0)} />
              <Stat label="Closed trades" value={String(account?.trades.length ?? 0)} />
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {access.paperTrading
              ? 'Free paper trading is enabled — practice without any risk.'
              : 'Sign in or subscribe to keep trading.'}
          </p>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <QuickLink
          to="/backtester"
          icon={<LineChart className="h-5 w-5 text-accent" aria-hidden="true" />}
          title="Backtester"
          desc="Test any strategy against historical data."
        />
        <QuickLink
          to="/signals"
          icon={<Bot className="h-5 w-5 text-accent" aria-hidden="true" />}
          title="Live signals"
          desc="Watch indicator-driven buy/sell signals."
        />
        <QuickLink
          to="/performance"
          icon={<ArrowRight className="h-5 w-5 text-accent" aria-hidden="true" />}
          title="Performance"
          desc="Review your robot's sessions and equity curve."
        />
      </div>

      {/* Watchlist */}
      <QuoteTable quotes={quotes} loading={quotesLoading} onSelect={() => undefined} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 tnum font-mono text-xl font-bold text-foreground">{value}</p>
    </div>
  )
}

function QuickLink({
  to,
  icon,
  title,
  desc,
}: {
  to: string
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-border bg-secondary/30 p-4',
        'transition-colors hover:border-accent/50 hover:bg-secondary/50',
      )}
    >
      <div className="rounded-lg bg-muted p-2">{icon}</div>
      <div>
        <p className="font-medium text-foreground group-hover:text-accent">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </Link>
  )
}