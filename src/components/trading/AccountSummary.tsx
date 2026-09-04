/**
 * AccountSummary — the paper/managed account's headline numbers: balance,
 * equity, unrealized PnL, open-position count, win rate and the current losing
 * streak. Equity is marked to the live watchlist rates so the numbers move in
 * real time. When the consecutive-loss breaker trips, a clear "standing down"
 * notice explains why the robot went quiet.
 */
import { ShieldAlert, Wallet } from 'lucide-react'
import type { AccountState, RatesMap } from '../../lib/trading/types'
import { equity, unrealizedPnl } from '../../lib/trading/engine'
import { consecutiveLosses } from '../../lib/trading/risk'
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

  const wins = account.trades.filter((t) => t.pnl > 0).length
  const winRate = account.trades.length > 0 ? (wins / account.trades.length) * 100 : 0
  const streak = consecutiveLosses(account.trades)
  const breaker = account.risk.maxConsecutiveLosses
  const standingDown = breaker > 0 && streak >= breaker

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
        {standingDown && (
          <p role="status" className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {streak} losses in a row — the robot is standing down until a win resets the streak or you raise the
            limit in Risk management.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {account.positions.length} open position{account.positions.length === 1 ? '' : 's'} ·{' '}
          {account.trades.length} closed trade{account.trades.length === 1 ? '' : 's'} · win rate{' '}
          <span className={cn('font-mono tnum font-semibold', winRate >= 50 ? 'text-up' : 'text-down')}>
            {winRate.toFixed(0)}%
          </span>
          {account.trades.length > 0 && (
            <>
              {' '}
              · current streak <span className="font-mono tnum font-semibold">{streak} loss{streak === 1 ? '' : 'es'}</span>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
