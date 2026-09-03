/**
 * AdBanner — a single approved, active ad rotated in from the `ads` table.
 * Clicking records a click + event server-side and opens the target URL.
 * Renders nothing when no approved ad is live, so pages stay clean.
 */
import { useCallback, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { useAds } from '../hooks/usePlatform'
import { incrementAdClick, logAdEvent } from '../lib/platform'
import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/cn'

export function AdBanner() {
  const { ads } = useAds()
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  const ad = ads?.find((a) => a.status === 'approved' && a.active) ?? null

  const onOpen = useCallback(() => {
    if (!ad) return
    void incrementAdClick(ad.id)
    void logAdEvent(user?.id ?? null, ad.id, 'click')
    if (ad.target_url) window.open(ad.target_url, '_blank', 'noopener,noreferrer')
  }, [ad, user?.id])

  if (!ad || dismissed) return null

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-r from-primary/10 via-transparent to-primary/10 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Megaphone className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer text-left text-sm text-foreground/90 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-medium">{ad.title}</span>
          {ad.price != null && <span className="ml-2 tnum font-mono text-xs text-up">{ad.price.toLocaleString()}</span>}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss ad"
          className={cn(
            'ml-auto cursor-pointer rounded-md px-2 py-0.5 text-xs text-muted-foreground',
            'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          ✕
        </button>
      </div>
    </div>
  )
}