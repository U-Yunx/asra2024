/**
 * AccountSummary — the paper/managed account's headline numbers: balance,
 * equity, unrealized PnL and open-position count. Equity is marked to the live
 * watchlist rates so the numbers move in real time.
 */
import { Wallet } from 'lucide-react'
import type { AccountState, RatesMap } from '../../lib/trading/types'
import { equity, unrealizedPnl } from '../../lib/trading/engine'
import { formatUsd } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Card, CardContent, CardHeader, CardTitle } from '../ui'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/40 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 tnum font-mono text-lg font-bold',
          tone === 'up' && 'text-up',
          tone === 'down' && 'text-down',
          tone === 'neutral' && 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function AccountSummary({ account, rates }: { account: AccountState; rates: RatesMap }) {
  const eq = equity(account, rates)
  const unreal = unrealizedPnl(account, rates)
  const pnl = eq - account.initialBalance

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-accent" aria-hidden="true" />
          Account
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Balance" value={formatUsd(account.balance)} tone="neutral" />
          <Stat label="Equity" value={formatUsd(eq)} tone="neutral" />
          <Stat label="Unrealized P&L" value={formatUsd(unreal)} tone={unreal >= 0 ? 'up' : 'down'} />
          <Stat
            label="Total P&L"
            value={`${formatUsd(pnl)} (${(account.initialBalance > 0 ? (pnl / account.initialBalance) * 100 : 0).toFixed(1)}%)`}
            tone={pnl >= 0 ? 'up' : 'down'}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {account.positions.length} open position{account.positions.length === 1 ? '' : 's'} · {account.trades.length}{' '}
          closed trade{account.trades.length === 1 ? '' : 's'}
        </p>
      </CardContent>
    </Card>
  )
}