/**
 * NewsTicker — a slow-scrolling ticker of live watchlist quotes. Uses the same
 * realtime-first quote stream as the rest of the app; respects reduced motion.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useQuotes } from '../hooks/useMarketData'
import { WATCHLIST } from '../lib/watchlist'
import { formatChange, formatPrice } from '../lib/format'
import { cn } from '../lib/cn'

export function NewsTicker() {
  const { quotes } = useQuotes()
  const prefersReduced = useRef(false)

  useEffect(() => {
    prefersReduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const items = useMemo(() => {
    const q = quotes ?? []
    return WATCHLIST.map((p) => {
      const quote = q.find((x) => x.symbol === p.symbol)
      return { symbol: p.symbol, quote }
    }).filter((x) => x.quote?.price != null)
  }, [quotes])

  if (items.length === 0) {
    return (
      <div className="flex h-9 items-center gap-2 overflow-hidden border-b border-border bg-muted/40 px-4 text-xs text-muted-foreground">
        <span className="shrink-0 font-semibold uppercase tracking-wide text-accent">Markets</span>
        <span>Waiting for live quotes…</span>
      </div>
    )
  }

  const row = (key: string) => (
    <div key={key} className="flex shrink-0 items-center gap-6 pr-6" aria-hidden={key === 'b'}>
      {items.map(({ symbol, quote }) => {
        const change = quote?.percent_change ?? quote?.change ?? 0
        return (
          <span key={symbol} className="flex items-center gap-2 whitespace-nowrap text-xs">
            <span className="font-semibold text-foreground/80">{symbol}</span>
            <span className="tnum font-mono">{formatPrice(quote?.price)}</span>
            <span className={cn('tnum font-mono', change < 0 ? 'text-down' : 'text-up')}>
              {formatChange(change)}
            </span>
          </span>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-9 items-center gap-2 overflow-hidden border-b border-border bg-muted/40 px-4 text-xs text-muted-foreground">
      <span className="shrink-0 font-semibold uppercase tracking-wide text-accent">Markets</span>
      <div className="flex min-w-0 overflow-hidden" aria-label="Live market prices">
        <div className={cn('flex shrink-0', !prefersReduced.current && 'animate-ticker')}>
          {row('a')}
          {row('b')}
        </div>
      </div>
    </div>
  )
}