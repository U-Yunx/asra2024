/**
 * QuoteTable — the watchlist as a dense table: pair, price, change and % change
 * with green/red tones. Optional row click via `onSelect`. Used by the
 * Dashboard, Signals and Market pairs pages.
 */
import type { Quote } from '../lib/types'
import { WATCHLIST, isCryptoPair } from '../lib/watchlist'
import { formatChange, formatPct, formatPrice, timeAgo } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from './ui'

export function QuoteTable({
  quotes,
  loading,
  onSelect,
  title = 'Market watchlist',
}: {
  quotes: Quote[] | null
  loading?: boolean
  onSelect?: (symbol: string) => void
  title?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {quotes && quotes.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {quotes.filter((q) => q.price != null).length}/{WATCHLIST.length} pairs quoting
          </span>
        )}
      </CardHeader>
      <CardContent>
        {loading && !quotes ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Pair</th>
                  <th className="pb-2 pr-4 font-medium">Market</th>
                  <th className="pb-2 pr-4 text-right font-medium">Price</th>
                  <th className="pb-2 pr-4 text-right font-medium">Change</th>
                  <th className="pb-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {WATCHLIST.map((p) => {
                  const quote = quotes?.find((q) => q.symbol === p.symbol)
                  const price = quote?.price
                  const change = quote?.percent_change ?? quote?.change ?? 0
                  const rowClass = onSelect && price != null ? 'cursor-pointer hover:bg-muted/40' : ''
                  return (
                    <tr
                      key={p.symbol}
                      className={cn('border-b border-border/50 last:border-b-0', rowClass)}
                      onClick={onSelect && price != null ? () => onSelect(p.symbol) : undefined}
                    >
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-foreground">{p.symbol}</span>
                        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{p.name}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge className={cn(isCryptoPair(p.symbol) ? 'border-accent/30 text-accent' : '')}>
                          {isCryptoPair(p.symbol) ? 'Crypto' : 'Forex'}
                        </Badge>
                      </td>
                      <td className="tnum py-2.5 pr-4 text-right font-mono text-foreground">
                        {price != null ? formatPrice(price) : '—'}
                      </td>
                      <td
                        className={cn(
                          'tnum py-2.5 pr-4 text-right font-mono',
                          price != null && (change < 0 ? 'text-down' : 'text-up'),
                        )}
                      >
                        {price != null ? formatChange(change) : '—'}
                      </td>
                      <td
                        className={cn(
                          'tnum py-2.5 text-right font-mono',
                          price != null && (change < 0 ? 'text-down' : 'text-up'),
                        )}
                      >
                        {price != null ? formatPct(change) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {quotes && quotes.length > 0 && (
          <p className="mt-3 text-right text-[11px] text-muted-foreground">
            {quotes[0]?.datetime ? `Updated ${timeAgo(quotes[0].datetime)}` : 'Waiting for updates…'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}