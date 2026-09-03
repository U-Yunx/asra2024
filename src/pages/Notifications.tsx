/**
 * Notifications — the full notification feed (user-targeted + admin
 * broadcasts), with a "mark all read" action that clears the header badge.
 */
import { BellOff, CheckCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useNotifications } from '../hooks/usePlatform'
import { formatDateTime } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from '../components/ui'

const TYPE_TONE: Record<string, string> = {
  info: 'bg-accent/20 text-accent',
  success: 'bg-up/20 text-up',
  warning: 'bg-amber/20 text-amber',
  error: 'bg-destructive/20 text-destructive',
}

export function Notifications() {
  const { notifications, unread, loading, markAllRead } = useNotifications()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `You have ${unread} unread.` : 'You’re all caught up.'}
        actions={
          unread > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => void markAllRead()}>
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Feed</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading notifications…</p>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<BellOff className="h-6 w-6" aria-hidden="true" />}
              title="Nothing here yet"
              message="Trade milestones, payment updates and admin announcements will land here."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {notifications.map((n) => (
                <li key={n.id} className={cn('flex items-start gap-3 px-1 py-4', !n.read_at && 'rounded-lg bg-primary/5')}>
                  <Badge className={cn('mt-0.5 shrink-0', TYPE_TONE[n.type] ?? TYPE_TONE.info)}>{n.type}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {n.link ? (
                        <Link to={n.link} className="hover:text-accent hover:underline">
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                    </p>
                    {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground/70">{formatDateTime(n.created_at)}</p>
                  </div>
                  {!n.read_at && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}