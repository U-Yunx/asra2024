/**
 * MyAds — submit and manage your own promotional ads. Every submission goes to
 * `pending` for admin review; approved ads are served across the app. Includes
 * a click/view history.
 */
import { useState } from 'react'
import { Megaphone, Trash2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAdEvents, useMyAds } from '../hooks/usePlatform'
import { submitAd, deleteAd } from '../lib/platform'
import { formatDateTime, timeAgo } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, PageHeader } from '../components/ui'

const STATUS_TONE: Record<string, string> = {
  approved: 'border-up/40 bg-up/15 text-up',
  pending: 'border-amber/40 bg-amber/15 text-amber',
  rejected: 'border-destructive/40 bg-destructive/15 text-destructive',
}

export function MyAds() {
  const { user } = useAuth()
  const { ads, loading, refresh } = useMyAds(user?.id)
  const { events } = useAdEvents(user?.id)

  const [title, setTitle] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [price, setPrice] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const submit = async () => {
    if (!user) return
    if (!title.trim()) {
      setError('Give your ad a title.')
      return
    }
    setBusy(true)
    setError(null)
    setOk(false)
    const res = await submitAd({
      userId: user.id,
      title,
      imageUrl,
      targetUrl,
      price: price ? Number(price) : null,
      priceCurrency: 'USD',
    })
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setOk(true)
    setTitle('')
    setImageUrl('')
    setTargetUrl('')
    setPrice('')
    void refresh()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My ads"
        description="Promote your offer across the platform. Ads are reviewed before going live."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-accent" aria-hidden="true" />
              Submit an ad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Copy-trade with 20% monthly" />
              <Input label="Image URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/banner.png" />
              <Input label="Target URL" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://…" />
              <Input label="Price (optional, USD)" type="number" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {ok && (
              <p role="status" className="mt-3 rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
                Ad submitted — it'll go live once an admin approves it.
              </p>
            )}

            <Button className="mt-4 w-full" loading={busy} onClick={() => void submit()}>
              Submit for review
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Your ads</CardTitle>
              {ads.length > 0 && <span className="text-xs text-muted-foreground">{ads.length} total</span>}
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading your ads…</p>
              ) : ads.length === 0 ? (
                <EmptyState
                  title="No ads yet"
                  message="Submit your first ad on the left — it will appear here with its review status."
                />
              ) : (
                <div className="space-y-3">
                  {ads.map((a) => (
                    <div key={a.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{a.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {a.target_url || 'No target URL'} · {a.clicks} clicks
                            {a.price != null ? ` · $${a.price.toLocaleString()}` : ''}
                          </p>
                          {a.reason && <p className="mt-1 text-xs text-muted-foreground">Note: {a.reason}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge className={cn(STATUS_TONE[a.status] ?? STATUS_TONE.pending)}>{a.status}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void deleteAd(a.id).then(() => refresh())}
                            aria-label={`Delete ${a.title}`}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground/70">Submitted {timeAgo(a.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ad history</CardTitle>
              {events.length > 0 && <span className="text-xs text-muted-foreground">{events.length} events</span>}
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Views and clicks on your ads will show up here.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Ad</th>
                        <th className="pb-2 pr-4 font-medium">Event</th>
                        <th className="pb-2 text-right font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.slice(0, 50).map((e) => (
                        <tr key={e.id} className="border-b border-border/50 last:border-b-0">
                          <td className="py-2.5 pr-4">{e.ads?.title ?? '—'}</td>
                          <td className="py-2.5 pr-4">
                            <Badge
                              className={cn(
                                e.event_type === 'click' ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border bg-muted text-muted-foreground',
                              )}
                            >
                              {e.event_type}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right text-xs text-muted-foreground">{formatDateTime(e.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}