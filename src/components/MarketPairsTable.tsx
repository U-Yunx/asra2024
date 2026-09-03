/**
 * MarketPairsTable — the full watchlist as a dense, sortable-looking table:
 * pair, asset class, price, change and % change. Used on the public Market
 * pairs page.
 */
import { CandlestickChart } from 'lucide-react'
import type { Quote } from '../lib/types'
import { WATCHLIST, isCryptoPair } from '../lib/watchlist'
import { formatChange, formatPct, formatPrice, timeAgo } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Card, CardContent, CardHeader, CardTitle } from './ui'

export function MarketPairsTable({ quotes }: { quotes: Quote[] | null }) {
  const rows = WATCHLIST.map((p) => ({
    pair: p,
    quote: quotes?.find((q) => q.symbol === p.symbol),
  }))
  const quoting = rows.filter((r) => r.quote?.price != null).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CandlestickChart className="h-4 w-4 text-accent" aria-hidden="true" />
          Watchlist
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {quoting}/{WATCHLIST.length} pairs quoting
        </span>
      </CardHeader>
      <CardContent>
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
              {rows.map(({ pair, quote }) => {
                const price = quote?.price
                const change = quote?.percent_change ?? quote?.change ?? 0
                return (
                  <tr key={pair.symbol} className="border-b border-border/50 last:border-b-0">
                    <td className="py-2.5 pr-4">
                      <span className="font-medium text-foreground">{pair.symbol}</span>
                      <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{pair.name}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge className={cn(isCryptoPair(pair.symbol) ? 'border-accent/30 text-accent' : '')}>
                        {isCryptoPair(pair.symbol) ? 'Crypto' : 'Forex'}
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
        {quotes && quotes.length > 0 && (
          <p className="mt-3 text-right text-[11px] text-muted-foreground">
            {quotes[0]?.datetime ? `Updated ${timeAgo(quotes[0].datetime)}` : 'Waiting for updates…'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
