/**
 * NotificationBell — header bell with an unread-count badge and a dropdown of
 * the latest notifications. "Mark all read" clears the badge in one click.
 * Accessible: toggle button + listbox, Escape/outside-click closes.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { useNotifications } from '../hooks/usePlatform'
import { timeAgo } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button } from './ui'

const TYPE_TONE: Record<string, string> = {
  info: 'bg-accent/20 text-accent',
  success: 'bg-up/20 text-up',
  warning: 'bg-amber/20 text-amber',
  error: 'bg-destructive/20 text-destructive',
}

export function NotificationBell() {
  const { notifications, unread, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-primary">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Mark all read
              </Button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                You're all caught up — no notifications yet.
              </li>
            )}
            {notifications.slice(0, 8).map((n) => (
              <li
                key={n.id}
                className={cn(
                  'border-b border-border/60 px-4 py-3 last:border-b-0',
                  !n.read_at && 'bg-primary/5',
                )}
              >
                <div className="flex items-start gap-2">
                  <Badge className={cn('mt-0.5 shrink-0', TYPE_TONE[n.type] ?? TYPE_TONE.info)}>
                    {n.type}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {n.link ? (
                        <Link to={n.link} className="hover:text-accent hover:underline">
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                    </p>
                    {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground/70">{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}