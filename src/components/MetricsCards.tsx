/**
 * MetricsCards — a grid of labelled stat cards for backtest/performance
 * summaries. Accepts an explicit item list so every page stays in control of
 * what it surfaces.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface MetricItem {
  label: string
  value: string
  tone?: 'up' | 'down' | 'neutral' | 'accent'
}

export function MetricsCards({ items, className }: { items: MetricItem[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', className)}>
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-border/60 bg-secondary/30 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.label}</p>
          <p
            className={cn(
              'mt-1 tnum font-mono text-lg font-bold',
              it.tone === 'up' && 'text-up',
              it.tone === 'down' && 'text-down',
              it.tone === 'accent' && 'text-accent',
              (!it.tone || it.tone === 'neutral') && 'text-foreground',
            )}
          >
            {it.value}
          </p>
        </div>
      ))}
    </div>
  )
}

export function MetricItemView({ children }: { children: ReactNode }) {
  return <>{children}</>
}