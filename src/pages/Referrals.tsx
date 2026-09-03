/**
 * Referrals — the user's referral link, downline list and commission status.
 * Earnings are tied to paid commissions on referred subscriptions.
 */
import { useState } from 'react'
import { Check, Copy, Gift, Users } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useDownline, useProfile } from '../hooks/usePlatform'
import { formatDateTime, formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from '../components/ui'

const STATUS_TONE: Record<string, string> = {
  paid: 'border-up/40 bg-up/15 text-up',
  pending: 'border-amber/40 bg-amber/15 text-amber',
  cancelled: 'border-border bg-muted text-muted-foreground',
}

export function Referrals() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { referrals, loading } = useDownline(user?.id)

  const [copied, setCopied] = useState(false)
  const refCode = profile?.referral_code ?? ''
  const refLink = refCode ? `${window.location.origin}/auth?ref=${refCode}` : ''

  const copy = async () => {
    if (!refLink) return
    try {
      await navigator.clipboard.writeText(refLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* noop */
    }
  }

  const earned = referrals.filter((r) => r.status === 'paid').reduce((s, r) => s + r.commission_amount, 0)
  const pending = referrals.filter((r) => r.status === 'pending').reduce((s, r) => s + r.commission_amount, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referrals"
        description="Share your link and earn a commission when referred friends subscribe."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total referred" value={String(referrals.length)} />
        <Stat label="Earned (paid)" value={formatUsd(earned)} tone="up" />
        <Stat label="Pending" value={formatUsd(pending)} tone="amber" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-accent" aria-hidden="true" />
            Your referral link
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!refCode ? (
            <p className="text-sm text-muted-foreground">Your referral code will appear here once you have an account.</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 truncate rounded-lg border border-border bg-background/60 px-3 py-2.5 font-mono text-sm text-foreground">
                {refLink}
              </code>
              <Button onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Earn a commission whenever a friend you referred buys a package. Payments are reviewed
            manually and show up under “Withdraw” when approved.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" aria-hidden="true" />
            Downline
          </CardTitle>
          {referrals.length > 0 && <span className="text-xs text-muted-foreground">{referrals.length} referred</span>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading referrals…</p>
          ) : referrals.length === 0 ? (
            <EmptyState
              title="No referrals yet"
              message="Share your link on social media or with friends who trade — you'll see their sign-ups here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Referred</th>
                    <th className="pb-2 pr-4 text-right font-medium">Commission</th>
                    <th className="pb-2 pr-4 text-right font-medium">Rate</th>
                    <th className="pb-2 pr-4 text-right font-medium">Status</th>
                    <th className="pb-2 text-right font-medium">Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 last:border-b-0">
                      <td className="py-2.5 pr-4">
                        {r.profiles?.display_name || r.profiles?.email || 'Anonymous'}
                      </td>
                      <td className="tnum py-2.5 pr-4 text-right font-mono">{formatUsd(r.commission_amount)}</td>
                      <td className="tnum py-2.5 pr-4 text-right font-mono">{r.commission_pct}%</td>
                      <td className="py-2.5 pr-4 text-right">
                        <Badge className={cn(STATUS_TONE[r.status] ?? STATUS_TONE.cancelled)}>{r.status}</Badge>
                      </td>
                      <td className="py-2.5 text-right text-xs text-muted-foreground">{formatDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'amber' }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 tnum font-mono text-xl font-bold',
          tone === 'up' && 'text-up',
          tone === 'amber' && 'text-amber',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}