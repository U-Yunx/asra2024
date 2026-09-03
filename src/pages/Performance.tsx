/**
 * Performance — the robot's history: every recorded session and the equity
 * curve captured while the robot ran, alongside the paper account's live
 * numbers. Data comes from `robot_sessions` + `robot_history`.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChartLine, Play } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { usePaperAccount } from '../lib/trading/usePaperAccount'
import { loadRobotHistory, type RobotPerformance } from '../lib/trading/robotHistory'
import { useQuotes } from '../hooks/useMarketData'
import { equity } from '../lib/trading/engine'
import type { RatesMap } from '../lib/trading/types'
import { formatDateTime, formatNum, formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from '../components/ui'
import { MetricsCards } from '../components/MetricsCards'
import { EquityChart } from '../components/EquityChart'

export function Performance() {
  const { user } = useAuth()
  const { account } = usePaperAccount()
  const { quotes } = useQuotes()
  const [perf, setPerf] = useState<RobotPerformance | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    void loadRobotHistory(user.id).then((p) => {
      setPerf(p)
      setLoading(false)
    })
  }, [user?.id])

  const sessions = perf?.sessions ?? []
  const history = perf?.history ?? []
  const totalPnl = sessions.reduce((sum, s) => sum + (s.pnl ?? 0), 0)
  const finished = sessions.filter((s) => s.status === 'finished')
  const winSessions = finished.filter((s) => (s.pnl ?? 0) > 0).length
  const winRate = finished.length > 0 ? (winSessions / finished.length) * 100 : 0
  const totalTrades = sessions.reduce((sum, s) => sum + (s.trade_count ?? 0), 0)

  const rates: RatesMap = Object.fromEntries(
    (quotes ?? [])
      .filter((q): q is typeof q & { price: number } => q.price != null)
      .map((q) => [q.symbol, q.price]),
  )
  const eq = account ? equity(account, rates) : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        description="Your robot's sessions, equity history and current paper-account standing."
      />

      <MetricsCards
        items={[
          { label: 'Paper balance', value: account ? formatUsd(account.balance) : '—', tone: 'neutral' },
          { label: 'Paper equity', value: formatUsd(eq), tone: eq >= (account?.balance ?? 0) ? 'up' : 'down' },
          { label: 'Sessions', value: String(sessions.length), tone: 'neutral' },
          { label: 'Session win rate', value: formatNum(winRate, 0) + '%', tone: winRate >= 50 ? 'up' : 'down' },
          { label: 'Total P&L (sessions)', value: formatUsd(totalPnl), tone: totalPnl >= 0 ? 'up' : 'down' },
          { label: 'Total trades', value: String(totalTrades), tone: 'neutral' },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChartLine className="h-4 w-4 text-accent" aria-hidden="true" />
            Equity history
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {history.length} points{history.length > 0 ? ` · ${formatDateTime(history[0].recorded_at)} → ${formatDateTime(history[history.length - 1].recorded_at)}` : ''}
          </span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : history.length === 0 ? (
            <EmptyState
              icon={<Play className="h-6 w-6" aria-hidden="true" />}
              title="No robot history yet"
              message="Run the trading robot for a while — its equity is recorded every second while it trades."
              action={
                <Link to="/trading">
                  <Button size="sm">
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Open the robot
                  </Button>
                </Link>
              }
            />
          ) : (
            <EquityChart points={history.map((h) => ({ time: h.recorded_at, equity: h.equity }))} height={260} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Robot sessions</CardTitle>
          {sessions.length > 0 && <span className="text-xs text-muted-foreground">{sessions.length} recorded</span>}
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sessions appear here after you run the robot on the trading page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 pr-4 font-medium">Method</th>
                    <th className="pb-2 pr-4 font-medium">Strategy</th>
                    <th className="pb-2 pr-4 text-right font-medium">Initial</th>
                    <th className="pb-2 pr-4 text-right font-medium">P&L</th>
                    <th className="pb-2 pr-4 text-right font-medium">Trades</th>
                    <th className="pb-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-border/50 last:border-b-0">
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground">{formatDateTime(s.started_at)}</td>
                      <td className="py-2.5 pr-4 capitalize">{s.method ?? '—'}</td>
                      <td className="py-2.5 pr-4">{s.strategy ?? '—'}</td>
                      <td className="tnum py-2.5 pr-4 text-right font-mono">{formatUsd(s.initial_balance)}</td>
                      <td
                        className={cn(
                          'tnum py-2.5 pr-4 text-right font-mono font-semibold',
                          (s.pnl ?? 0) >= 0 ? 'text-up' : 'text-down',
                        )}
                      >
                        {formatUsd(s.pnl ?? 0)}
                      </td>
                      <td className="tnum py-2.5 pr-4 text-right font-mono">{s.trade_count}</td>
                      <td className="py-2.5 text-right">
                        <Badge
                          className={cn(
                            s.status === 'running'
                              ? 'border-up/40 bg-up/15 text-up'
                              : 'border-border bg-muted text-muted-foreground',
                          )}
                        >
                          {s.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}