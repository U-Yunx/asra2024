/**
 * PositionsTable — live open positions with mark-to-market PnL in USD, plus a
 * close button that routes through the active broker. Multi-pair robots: rows
 * are grouped by pair, each group shows an "open/cap" chip reflecting the
 * robot's trade mode and per-pair cap, and the card header shows the global
 * cap. Empty state explains that nothing is open yet and how to open a trade.
 */
import { X } from 'lucide-react'
import type { AccountState, Position, RatesMap, TradeMode } from '../../lib/trading/types'
import { pnlUsd } from '../../lib/trading/risk'
import { formatDateTime, formatPrice, formatUnits, formatUsd } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '../ui'

export interface RobotCaps {
  tradeMode: TradeMode
  maxPerPair: number
  maxOpenTrades: number
}

function perPairCap(caps?: RobotCaps): number {
  if (!caps) return 1
  return caps.tradeMode === 'concurrent' ? caps.maxPerPair : 1
}

export function PositionsTable({
  account,
  rates,
  onClose,
  robotCaps,
}: {
  account: AccountState
  rates: RatesMap
  onClose: (id: string) => void
  robotCaps?: RobotCaps
}) {
  const { positions } = account

  // Group positions by pair, preserving watchlist order.
  const bySymbol = new Map<string, Position[]>()
  for (const p of positions) {
    const arr = bySymbol.get(p.symbol) ?? []
    arr.push(p)
    bySymbol.set(p.symbol, arr)
  }
  const groups = [...bySymbol.entries()]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open positions</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {positions.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {positions.length} open{robotCaps ? ` · max ${robotCaps.maxOpenTrades}` : ''}
            </span>
          )}
          {robotCaps && (
            <Badge className="border-border bg-muted text-muted-foreground">
              {robotCaps.tradeMode === 'concurrent' ? 'Concurrent' : 'Sequential'} · {perPairCap(robotCaps)}/pair
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <EmptyState
            title="No open positions"
            message="Open a trade with the form above, or start the robot and it will trade on signals automatically."
          />
        ) : (
          <div className="space-y-4 overflow-x-auto">
            {groups.map(([symbol, rows]) => {
              const cap = perPairCap(robotCaps)
              const atCap = rows.length >= cap
              return (
                <div key={symbol} className="overflow-hidden rounded-lg border border-border/60">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-secondary/40 px-3 py-2">
                    <span className="text-sm font-semibold text-foreground">{symbol}</span>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={cn(
                          atCap ? 'border-amber/40 bg-amber/10 text-amber' : 'border-border bg-muted text-muted-foreground',
                        )}
                      >
                        {rows.length}/{cap} open
                      </Badge>
                      <span className="text-xs text-muted-foreground">{rows.length} position{rows.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Side</th>
                        <th className="pb-2 pr-4 text-right font-medium">Units</th>
                        <th className="pb-2 pr-4 text-right font-medium">Entry</th>
                        <th className="pb-2 pr-4 text-right font-medium">Mark</th>
                        <th className="pb-2 pr-4 text-right font-medium">Stop / Target</th>
                        <th className="pb-2 pr-4 text-right font-medium">P&L</th>
                        <th className="pb-2 pr-4 text-right font-medium">Opened</th>
                        <th className="pb-2 font-medium" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => {
                        const mark = rates[p.symbol] ?? p.entryPrice
                        const pnl = pnlUsd(p.side, p.entryPrice, mark, p.units, p.symbol, rates)
                        return (
                          <tr key={p.id} className="border-b border-border/60 last:border-b-0">
                            <td className="py-3 pr-4">
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-xs font-semibold',
                                  p.side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
                                )}
                              >
                                {p.side.toUpperCase()}
                              </span>
                            </td>
                            <td className="tnum py-3 pr-4 text-right font-mono">{formatUnits(p.units)}</td>
                            <td className="tnum py-3 pr-4 text-right font-mono">{formatPrice(p.entryPrice)}</td>
                            <td className="tnum py-3 pr-4 text-right font-mono">{formatPrice(mark)}</td>
                            <td className="tnum py-3 pr-4 text-right font-mono">
                              {formatPrice(p.stopPrice)} / {formatPrice(p.takeProfitPrice)}
                            </td>
                            <td
                              className={cn(
                                'tnum py-3 pr-4 text-right font-mono font-semibold',
                                pnl >= 0 ? 'text-up' : 'text-down',
                              )}
                            >
                              {formatUsd(pnl)}
                            </td>
                            <td className="py-3 pr-4 text-right text-xs text-muted-foreground">
                              {formatDateTime(p.entryTime)}
                            </td>
                            <td className="py-3 text-right">
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => onClose(p.id)}
                                aria-label={`Close ${p.symbol} position`}
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                                Close
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}