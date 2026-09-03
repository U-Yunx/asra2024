/**
 * Profile — the signed-in user's personal settings: legal name, identity
 * verification, the "trade at your own risk" disclaimer and WhatsApp
 * notification preferences.
 */
import { useState, type FormEvent } from 'react'
import { BadgeCheck, FileCheck2, ShieldAlert, Smartphone } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/usePlatform'
import { acceptRisk, saveRealName, saveWhatsAppPrefs, submitIdentityCheck } from '../lib/platform'
import { formatDateTime } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader, Skeleton } from '../components/ui'

const IDENTITY_TONE: Record<string, string> = {
  verified: 'text-up border-up/40 bg-up/10',
  pending: 'text-amber border-amber/40 bg-amber/10',
  rejected: 'text-destructive border-destructive/40 bg-destructive/10',
  unverified: 'text-muted-foreground border-border bg-muted/40',
}

export function Profile() {
  const { user } = useAuth()
  const { profile, loading, refresh } = useProfile()

  const [realName, setRealName] = useState('')
  const [doc, setDoc] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [waEnabled, setWaEnabled] = useState(false)
  const [waDaily, setWaDaily] = useState(false)
  const [waTrades, setWaTrades] = useState(false)
  const [waEvents, setWaEvents] = useState(false)
  const [waMaintenance, setWaMaintenance] = useState(false)

  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  function flash(kind: 'ok' | 'err', text: string) {
    setMsg({ kind, text })
    window.setTimeout(() => setMsg(null), 5000)
  }

  async function handleName(e: FormEvent) {
    e.preventDefault()
    if (!user || !realName.trim()) return
    setBusy(true)
    const err = await saveRealName(user.id, realName)
    setBusy(false)
    if (err) flash('err', err)
    else {
      flash('ok', 'Legal name saved.')
      setRealName('')
      await refresh()
    }
  }

  async function handleIdentity(e: FormEvent) {
    e.preventDefault()
    if (!user || !doc.trim()) return
    setBusy(true)
    const err = await submitIdentityCheck(user.id, doc)
    setBusy(false)
    if (err) flash('err', err)
    else {
      flash('ok', 'Identity check submitted — an admin will review it.')
      setDoc('')
      await refresh()
    }
  }

  async function handleRisk() {
    if (!user) return
    setBusy(true)
    const err = await acceptRisk(user.id)
    setBusy(false)
    if (err) flash('err', err)
    else {
      flash('ok', 'Disclaimer accepted — you can now trade.')
      await refresh()
    }
  }

  async function handleWhatsApp(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    const err = await saveWhatsAppPrefs(user.id, {
      whatsapp_phone: whatsapp,
      whatsapp_enabled: waEnabled,
      whatsapp_daily_summary: waDaily,
      whatsapp_trade_summary: waTrades,
      whatsapp_robot_events: waEvents,
      whatsapp_maintenance: waMaintenance,
    })
    setBusy(false)
    if (err) flash('err', err)
    else flash('ok', 'WhatsApp preferences saved.')
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader title="Profile" description="Your personal settings." />
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="Profile"
        description="Keep your details up to date — they're used for payouts and identity checks."
        actions={
          profile && (
            <Badge className="capitalize">
              {profile.role} · {profile.email}
            </Badge>
          )
        }
      />

      {msg && (
        <div
          className={cn(
            'mb-4 rounded-lg border px-4 py-3 text-sm',
            msg.kind === 'ok' ? 'border-up/40 bg-up/10 text-up' : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {msg.text}
        </div>
      )}

      {!profile ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Sign in to manage your profile.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Legal name
                </span>
              </CardTitle>
            </CardHeader>
            <form onSubmit={handleName} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Input
                label="Real name (as on your ID)"
                placeholder={profile.real_name ?? 'e.g. Budi Santoso'}
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
              />
              <Button type="submit" loading={busy} disabled={!realName.trim()}>
                Save name
              </Button>
            </form>
            {profile.real_name && <p className="mt-2 text-xs text-muted-foreground">Current: {profile.real_name}</p>}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Identity verification
                </span>
              </CardTitle>
              <Badge className={cn('capitalize', IDENTITY_TONE[profile.identity_status] ?? IDENTITY_TONE.unverified)}>
                {profile.identity_status}
              </Badge>
            </CardHeader>
            <form onSubmit={handleIdentity} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Input
                label="ID document reference (passport / national ID number)"
                placeholder="e.g. A1234567"
                value={doc}
                onChange={(e) => setDoc(e.target.value)}
              />
              <Button type="submit" loading={busy} disabled={!doc.trim() || profile.identity_status === 'pending'}>
                Submit
              </Button>
            </form>
            {profile.identity_reason && (
              <p className="mt-2 text-xs text-muted-foreground">Admin note: {profile.identity_reason}</p>
            )}
            {profile.identity_verified_at && (
              <p className="mt-2 text-xs text-muted-foreground">
                Verified {formatDateTime(profile.identity_verified_at)}.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Risk disclaimer
                </span>
              </CardTitle>
              {profile.risk_accepted ? (
                <Badge className="text-up border-up/40 bg-up/10">Accepted</Badge>
              ) : (
                <Badge className="text-amber border-amber/40 bg-amber/10">Required</Badge>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Trading is risky. You accept that you trade at your own risk and that the robot never guarantees
                profits. This must be accepted before you can run the robot.
              </p>
              {profile.risk_accepted ? (
                profile.risk_accepted_at && (
                  <p className="mt-2 text-xs text-muted-foreground">Accepted {formatDateTime(profile.risk_accepted_at)}.</p>
                )
              ) : (
                <Button variant="danger" className="mt-4" onClick={handleRisk} loading={busy}>
                  I accept — let me trade
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  WhatsApp notifications
                </span>
              </CardTitle>
            </CardHeader>
            <form onSubmit={handleWhatsApp} className="space-y-3">
              <Input
                label="WhatsApp number (E.164, e.g. +628123456789)"
                placeholder={profile.whatsapp_phone ?? '+62…'}
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={waEnabled}
                  onChange={(e) => setWaEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                Enable WhatsApp robot alerts
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['Daily win/loss summary', waDaily, setWaDaily],
                    ['Trade open/close summary', waTrades, setWaTrades],
                    ['Robot start/stop events', waEvents, setWaEvents],
                    ['Maintenance / auto-tune alerts', waMaintenance, setWaMaintenance],
                  ] as const
                ).map(([label, checked, set]) => (
                  <label key={label} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => set(e.target.checked)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <Button type="submit" loading={busy}>
                Save WhatsApp preferences
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  )
}
