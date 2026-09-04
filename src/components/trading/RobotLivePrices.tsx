/**
 * RobotLivePrices — live price strip for the pairs the robot is watching.
 * Subscribes to the same Realtime broadcast the rest of the app uses, so the
 * numbers move the moment fresh quotes land.
 */
import { Activity } from 'lucide-react'
import type { Quote } from '../../lib/types'
import { useQuotes } from '../../hooks/useMarketData'
import { formatChange, formatPct, formatPrice } from '../../lib/format'
import { cn } from '../../lib/cn'

export function RobotLivePrices({ pairs }: { pairs: string[] }) {
  const { quotes, loading, error } = useQuotes(15_000, pairs)

  const rows = (quotes ?? []).filter((q) => pairs.includes(q.symbol))

  if (loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-secondary/30 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
          Live prices
        </p>
        <p className="text-sm text-muted-foreground">Loading prices…</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      <p className="mb-3 flex items-center justify-between gap-1.5 text-sm font-semibold text-foreground">
        <span className="flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
          Live prices
        </span>
        {rows.length > 0 && <span className="text-[11px] font-normal text-muted-foreground">{rows.length} pair{rows.length === 1 ? '' : 's'}</span>}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{error ?? 'Waiting for prices…'}</p>
      ) : (
        <ul className="space-y-2" aria-live="polite">
          {rows.map((q) => (
            <QuoteRow key={q.symbol} quote={q} />
          ))}
        </ul>
      )}
    </div>
  )
}

function QuoteRow({ quote }: { quote: Quote }) {
  const up = (quote.change ?? 0) >= 0
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="font-medium text-foreground">{quote.symbol}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono tnum text-foreground">
          {quote.price != null ? formatPrice(quote.price) : '—'}
        </span>
        {quote.change != null && (
          <span className={cn('font-mono tnum text-xs', up ? 'text-up' : 'text-down')}>
            {formatChange(quote.change)}
          </span>
        )}
        {quote.percent_change != null && (
          <span className={cn('hidden font-mono tnum text-xs sm:inline', up ? 'text-up' : 'text-down')}>
            {formatPct(quote.percent_change)}
          </span>
        )}
      </span>
    </li>
  )
}
