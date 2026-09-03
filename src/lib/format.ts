/** Shared number / date formatting helpers. All prices use tabular numerals. */

/** "$1,234.56" */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Grouped number with fixed decimals, e.g. formatNum(12.345, 2) -> "12.35". */
export function formatNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Grouped integer (units, counts), e.g. formatUnits(12345) -> "12,345". */
export function formatUnits(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/** Signed change, e.g. "+0.00012" or "-1.04". */
export function formatChange(change: number | null | undefined): string {
  if (change == null || !Number.isFinite(change)) return '—'
  const sign = change > 0 ? '+' : ''
  return `${sign}${formatPrice(change)}`
}

/** Signed percentage, e.g. "+1.23%" / "-0.45%". */
export function formatPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

/** Adaptive-decimal price: fx 5 dp, crypto 4 dp near 1, 2 dp above 1000. */
export function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—'
  const abs = Math.abs(price)
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 2 : abs >= 1 ? 4 : 5
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Human relative time, e.g. "just now", "3m ago", "2h ago". */
export function timeAgo(iso: string | number | null | undefined): string {
  if (iso == null || iso === '') return '—'
  const then = typeof iso === 'number' ? iso : new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diff = Date.now() - then
  if (diff < 45_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDateTime(iso as string | number)
}

/** "Mar 4, 14:22" */
export function formatDateTime(iso: string | number | null | undefined): string {
  if (iso == null || iso === '') return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}