/**
 * SignalBadge — a small coloured badge for a strategy signal (buy/sell/neutral)
 * used across the Signals page and robot summary.
 */
import type { Signal } from '../lib/types'
import { cn } from '../lib/cn'

const TONE: Record<Signal, string> = {
  buy: 'border-up/40 bg-up/15 text-up',
  sell: 'border-down/40 bg-down/15 text-down',
  neutral: 'border-border bg-muted text-muted-foreground',
}

export function SignalBadge({ signal, className }: { signal: Signal; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase',
        TONE[signal],
        className,
      )}
    >
      {signal === 'neutral' ? 'Neutral' : signal === 'buy' ? 'Buy' : 'Sell'}
    </span>
  )
}