/**
 * TradeJournal — every closed trade on the account, newest first. Shows the
 * pair, side, entry/exit, and realized PnL so the trader can review exactly
 * what the robot (or they) did.
 */
import { BookOpen } from 'lucide-react'
import type { ClosedTrade } from '../../lib/trading/types'
import { formatDateTime, formatPrice, formatUsd } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '../ui'

const REASON_LABEL: Record<string, string> = {
  signal: 'Signal',
  stop_loss: 'Stop loss',
  take_profit: 'Take profit',
  manual: 'Manual',
  risk: 'Risk',
  robot_stop: 'Robot stop',
}

export function TradeJournal({ trades }: { trades: ClosedTrade[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-accent" aria-hidden="true" />
          Trade journal
        </CardTitle>
        {trades.length > 0 && <span className="text-xs text-muted-foreground">{trades.length} trades</span>}
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
            title="No closed trades yet"
            message="Once a position is closed — manually, by a stop, or by the robot — it lands here with its full P&L."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Pair</th>
                  <th className="pb-2 pr-4 font-medium">Side</th>
                  <th className="pb-2 pr-4 text-right font-medium">Entry → Exit</th>
                  <th className="pb-2 pr-4 text-right font-medium">P&amp;L</th>
                  <th className="pb-2 pr-4 font-medium">Reason</th>
                  <th className="pb-2 pr-4 font-medium">Strategy</th>
                  <th className="pb-2 text-right font-medium">Closed</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 last:border-b-0">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{t.symbol}</td>
                    <td className="py-2.5 pr-4 capitalize text-muted-foreground">{t.side}</td>
                    <td className="tnum py-2.5 pr-4 text-right font-mono text-xs text-muted-foreground">
                      {formatPrice(t.entryPrice)} → {formatPrice(t.exitPrice)}
                    </td>
                    <td
                      className={cn(
                        'tnum py-2.5 pr-4 text-right font-mono font-semibold',
                        t.pnl >= 0 ? 'text-up' : 'text-down',
                      )}
                    >
                      {formatUsd(t.pnl)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge className="border-border bg-muted text-muted-foreground">
                        {REASON_LABEL[t.closeReason] ?? t.closeReason}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">{t.strategy ?? '—'}</td>
                    <td className="py-2.5 text-right text-xs text-muted-foreground">{formatDateTime(t.exitTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
