/**
 * Account — the signed-in user's account overview: plan/access status, active
 * subscriptions and broker connections. Read-only dashboard of what the user
 * has, with links to manage each part.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, CreditCard, Link2, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAccess, useBrokers, useProfile, useSubscriptions } from '../hooks/usePlatform'
import { formatDateTime, formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from '../components/ui'

const STATUS_TONE: Record<string, string> = {
  admin: 'text-accent border-accent/40 bg-accent/10',
  active: 'text-up border-up/40 bg-up/10',
  trial: 'text-amber border-amber/40 bg-amber/10',
  expired: 'text-destructive border-destructive/40 bg-destructive/10',
  none: 'text-muted-foreground border-border bg-muted/40',
}

const SUB_STATUS: Record<string, string> = {
  pending: 'text-amber border-amber/40 bg-amber/10',
  active: 'text-up border-up/40 bg-up/10',
  rejected: 'text-destructive border-destructive/40 bg-destructive/10',
  expired: 'text-muted-foreground border-border bg-muted/40',
}

export function Account() {
  const { user } = useAuth()
  const { profile, loading: profileLoading } = useProfile()
  const { subscriptions } = useSubscriptions(user?.id)
  const { connections } = useBrokers(user?.id)
  const access = useAccess(profile, subscriptions)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="Account"
        description="Your plan, access and connections at a glance."
        actions={
          <Button variant="secondary" size="sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <UserRound className="h-4 w-4" aria-hidden="true" />
            {profile?.display_name ?? profile?.email ?? 'Signed in'}
          </Button>
        }
      />

      {profileLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Access</CardTitle>
              <Badge className={cn('capitalize', STATUS_TONE[access.status] ?? STATUS_TONE.none)}>{access.status}</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {access.hasAccess
                  ? 'You can run robots and trade right now.'
                  : 'No active plan — grab a package to start trading.'}
              </p>
              <Link
                to="/packages"
                className="mt-4 inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.97]"
              >
                View packages <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Subscriptions</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {subscriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchases yet.</p>
              ) : (
                <ul className="space-y-2">
                  {subscriptions.slice(0, 3).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{s.packages?.name ?? 'Plan'}</span>
                      <Badge className={cn('capitalize', SUB_STATUS[s.status] ?? '')}>{s.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Brokers</CardTitle>
              <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {connections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No broker accounts linked.</p>
              ) : (
                <ul className="space-y-2">
                  {connections.slice(0, 3).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{c.brokers?.name ?? c.platform}</span>
                      <Badge className={cn('capitalize', c.status === 'verified' ? 'text-up border-up/40 bg-up/10' : '')}>
                        {c.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/brokers"
                className="mt-4 inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.97]"
              >
                Manage brokers <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Profile details
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-medium text-foreground">{profile.email ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Referral code</dt>
                  <dd className="font-mono text-foreground">{profile.referral_code || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Commission earned</dt>
                  <dd className="font-medium text-foreground">{formatUsd(profile.commission_earned)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Member since</dt>
                  <dd className="font-medium text-foreground">{formatDateTime(profile.created_at)}</dd>
                </div>
              </dl>
            ) : (
              <EmptyState icon={<UserRound className="h-8 w-8" aria-hidden="true" />} title="No profile yet" message="Sign in to see your account details." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
