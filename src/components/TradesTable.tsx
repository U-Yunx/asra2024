/**
 * TradesTable — a read-only table of closed trades (used by the Backtester and
 * Performance page to show what happened on every position). Empty state guides
 * the user to run a backtest first.
 */
import type { Trade } from '../lib/types'
import { formatDateTime, formatPrice, formatUnits } from '../lib/format'
import { cn } from '../lib/cn'
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from './ui'

export function TradesTable({ trades, title = 'Trades' }: { trades: Trade[]; title?: string }) {
  const hasSymbols = trades.some((t) => !!t.symbol)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {trades.length > 0 && <span className="text-xs text-muted-foreground">{trades.length} trades</span>}
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <EmptyState
            title="No trades recorded"
            message="Run a backtest or let the robot trade — every position will show up here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">#</th>
                  {hasSymbols && <th className="pb-2 pr-4 font-medium">Pair</th>}
                  <th className="pb-2 pr-4 font-medium">Side</th>
                  <th className="pb-2 pr-4 text-right font-medium">Entry</th>
                  <th className="pb-2 pr-4 text-right font-medium">Exit</th>
                  <th className="pb-2 pr-4 text-right font-medium">Units</th>
                  <th className="pb-2 pr-4 text-right font-medium">P&L</th>
                  <th className="pb-2 pr-4 text-right font-medium">Return</th>
                  <th className="pb-2 text-right font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-b-0">
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">{i + 1}</td>
                    {hasSymbols && (
                      <td className="py-2.5 pr-4 text-xs font-medium text-foreground">{t.symbol ?? '—'}</td>
                    )}
                    <td className="py-2.5 pr-4">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs font-semibold',
                          t.side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
                        )}
                      >
                        {t.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="tnum py-2.5 pr-4 text-right font-mono">{formatPrice(t.entryPrice)}</td>
                    <td className="tnum py-2.5 pr-4 text-right font-mono">
                      {t.exitPrice != null ? formatPrice(t.exitPrice) : '—'}
                    </td>
                    <td className="tnum py-2.5 pr-4 text-right font-mono">{formatUnits(Number(t.entryPrice))}</td>
                    <td
                      className={cn(
                        'tnum py-2.5 pr-4 text-right font-mono font-semibold',
                        t.pnl >= 0 ? 'text-up' : 'text-down',
                      )}
                    >
                      {t.pnl >= 0 ? '+' : ''}
                      {t.pnl.toFixed(2)} pts
                    </td>
                    <td
                      className={cn(
                        'tnum py-2.5 pr-4 text-right font-mono',
                        t.pnlPct >= 0 ? 'text-up' : 'text-down',
                      )}
                    >
                      {t.pnlPct >= 0 ? '+' : ''}
                      {t.pnlPct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 text-right text-xs text-muted-foreground">{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trades.length > 0 && (
              <p className="mt-3 text-right text-[11px] text-muted-foreground">
                First entry {formatDateTime(trades[0].entryTime)}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}