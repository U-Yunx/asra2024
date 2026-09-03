import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  CircleDot,
  CloudUpload,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useBrokers, useProfile } from '../hooks/usePlatform'
import {
  fetchBrokerTokenStatus,
  generateBrokerToken,
  provisionMarketDataFromBroker,
  removeConnection,
  revokeBrokerToken,
  saveConnection,
} from '../lib/platform'
import { fn } from '../lib/functions'
import type { BrokerConnectionRow, BrokerPlatform, BrokerRow, BrokerTokenStatus } from '../lib/types'
import { cn } from '../lib/cn'
import { formatDateTime } from '../lib/format'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader, Select, Skeleton } from '../components/ui'

const STATUS_STYLES: Record<string, string> = {
  available: 'border-up/40 bg-up/10 text-up',
  maintenance: 'border-amber/40 bg-amber/10 text-amber',
  coming_soon: 'border-border bg-muted text-muted-foreground',
}

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  maintenance: 'Maintenance',
  coming_soon: 'Coming soon',
}

/** The trading platform the robot uses for a catalog broker. */
function platformOf(broker: BrokerRow): BrokerPlatform {
  if (broker.platform) return broker.platform
  if (broker.slug === 'mt4') return 'mt4'
  if (broker.slug === 'mt5') return 'mt5'
  return 'oanda'
}

function connectionSummary(broker: BrokerRow): { kind: string; hint: string } {
  if (!broker.requires_api_key) return { kind: 'MetaTrader account', hint: 'Account login · password · server' }
  return { kind: 'REST API key', hint: 'API token · account ID' }
}

type MtStatus =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'not-provisioned' }
  | { kind: 'error'; message: string }

/**
 * Live-trading readiness for a connected MetaTrader account, surfaced on the
 * broker card. Verifies against the MetaApi bridge (broker-mt) and lets the
 * user provision the account right from the card if it isn't activated yet.
 */
function MtConnectionStatus() {
  const [status, setStatus] = useState<MtStatus>({ kind: 'checking' })
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    setStatus({ kind: 'checking' })
    const { data, error } = await fn<{ ok?: boolean; provisioned?: boolean }>(
      'broker-mt',
      { body: { action: 'verify' }, fallback: 'Could not reach the MetaTrader bridge.' },
    )
    if (!data?.ok) {
      setStatus({ kind: 'error', message: error ?? 'Could not reach the MetaTrader bridge.' })
      return
    }
    setStatus(data.provisioned ? { kind: 'ready' } : { kind: 'not-provisioned' })
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  const activate = async () => {
    setBusy(true)
    const { error } = await fn<{ ok?: boolean }>(
      'broker-mt',
      { body: { action: 'provision' }, fallback: 'Could not provision this account.' },
    )
    setBusy(false)
    if (error) {
      setStatus({ kind: 'error', message: error })
      return
    }
    await check()
  }

  if (status.kind === 'checking') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Checking live-trading bridge…
      </span>
    )
  }
  if (status.kind === 'ready') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-up">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Live trading ready
      </span>
    )
  }
  if (status.kind === 'not-provisioned') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-amber">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Live trading not activated
        </span>
        <Button variant="secondary" size="sm" onClick={() => void activate()} loading={busy}>
          <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
          Activate live trading
        </Button>
      </div>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CircleDot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {status.message}
    </span>
  )
}

/* ------------------------------ Connect panel ------------------------------ */

function ConnectPanel({
  brokers,
  connections,
  selectedId,
  onSelect,
  onSaved,
}: {
  brokers: BrokerRow[]
  connections: BrokerConnectionRow[]
  selectedId: string
  onSelect: (id: string) => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const broker = brokers.find((b) => b.id === selectedId) ?? null
  const isApi = broker ? broker.requires_api_key : true

  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState('')
  const [accountType, setAccountType] = useState<'practice' | 'live'>('practice')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copyReferral = async () => {
    try {
      await navigator.clipboard.writeText(broker?.admin_referral_code ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* noop */
    }
  }

  /** Verify an MT account against the MetaApi bridge through broker-mt. */
  const verifyMt = useCallback(async (): Promise<{ provisioned: boolean; error: string | null }> => {
    const { data, error } = await fn<{ ok?: boolean; provisioned?: boolean }>(
      'broker-mt',
      { body: { action: 'verify' }, fallback: 'Could not reach the MetaTrader bridge.' },
    )
    if (!data?.ok) return { provisioned: false, error: error ?? 'Could not reach the MetaTrader bridge.' }
    return { provisioned: !!data.provisioned, error: null }
  }, [])

  /** Provision a saved MT account in MetaApi (deploy to their cloud) via broker-mt. */
  const provisionMt = useCallback(async (): Promise<string | null> => {
    const { error } = await fn<{ ok?: boolean }>(
      'broker-mt',
      { body: { action: 'provision' }, fallback: 'MetaApi could not provision this account.' },
    )
    return error
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !broker) return
    setBusy(true)
    setError(null)
    setSuccess(null)

    const platform = platformOf(broker)

    if (isApi) {
      if (!apiKey.trim()) {
        setError('Enter your broker API token.')
        setBusy(false)
        return
      }
      const { error: saveErr } = await saveConnection({
        userId: user.id,
        brokerId: broker.id,
        apiKey,
        accountId: accountId.trim() || undefined,
        accountType,
        platform,
      })
      if (saveErr) {
        setError(saveErr)
        setBusy(false)
        return
      }
      if (platform === 'oanda') {
        // Every REST-API broker in the catalog executes through the OANDA bridge.
        const { data, error } = await fn<{ ok?: boolean; accounts?: unknown[] }>(
          'broker-oanda',
          { body: { action: 'verify' }, fallback: 'The broker could not verify this token. Double-check it and try again.' },
        )
        if (!data?.ok) {
          setError(error ?? 'The broker could not verify this token. Double-check it and try again.')
          setBusy(false)
          return
        }
        setSuccess(`Connected & verified — ${data.accounts?.length ?? 0} account(s) reachable.`)
      } else {
        setSuccess('Connection saved — trading via this broker activates when its execution API comes online.')
      }
    } else {
      if (!login.trim() || !password.trim()) {
        setError('Enter your MT account login and password.')
        setBusy(false)
        return
      }
      if (!server.trim()) {
        setError('Enter your MT server (e.g. Exness-Real1) — find it in your broker client.')
        setBusy(false)
        return
      }
      // Reject duplicates up-front: the same MT login can only be connected once.
      // Allow re-saving the account on its existing slot (same broker) — that's an update.
      const ownConnection = connections.find((c) => c.broker_id === broker.id)
      const dup = connections.find(
        (c) =>
          (c.platform === 'mt4' || c.platform === 'mt5') &&
          c.account_id === login.trim() &&
          c.id !== ownConnection?.id,
      )
      if (dup) {
        setError(
          `This MetaTrader account (#${login.trim()}) is already connected${dup.brokers?.name ? ` to ${dup.brokers.name}` : ''}. Disconnect it from its current slot before adding it again.`,
        )
        setBusy(false)
        return
      }
      const { error: saveErr } = await saveConnection({
        userId: user.id,
        brokerId: broker.id,
        // Stored server-side as the account credential; never returned to the browser.
        apiKey: password,
        accountId: login.trim(),
        accountType,
        platform,
        server: server.trim(),
      })
      if (saveErr) {
        setError(saveErr)
        setBusy(false)
        return
      }
      // The credentials are saved. Now verify against the MetaApi bridge and, if
      // the account isn't provisioned yet, provision it so live trading works.
      const { provisioned, error: verifyErr } = await verifyMt()
      if (verifyErr) {
        // The bridge itself isn't reachable (e.g. METAAPI_TOKEN not set yet).
        // The connection is saved and will become tradeable once the bridge is configured.
        setSuccess(
          `MetaTrader account connected & saved. Live trading will activate as soon as the MT bridge is configured (${verifyErr})`,
        )
      } else if (provisioned) {
        setSuccess('MetaTrader account connected & verified — ready to trade live.')
      } else {
        const provisionErr = await provisionMt()
        setSuccess(
          provisionErr
            ? `MetaTrader account connected & saved. One more step to activate live trading: ${provisionErr}`
            : 'MetaTrader account connected & provisioned — deploying on MetaApi, ready to trade in about a minute.',
        )
      }
    }

    setBusy(false)
    setApiKey('')
    setAccountId('')
    setLogin('')
    setPassword('')
    setServer('')
    onSaved()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a broker account</CardTitle>
        <Badge className="border-border bg-muted text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          {brokers.length} supported
        </Badge>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3">
          <Select label="Broker" value={selectedId} onChange={(e) => onSelect(e.target.value)}>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>

          {broker && (
            <div key={broker.id} className="grid gap-3">
              {isApi ? (
                <>
                  <Input
                    type="password"
                    label="API token / key"
                    placeholder="Paste your broker API token"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    required
                  />
                  <Input
                    label="Account ID (optional)"
                    placeholder="e.g. 101-004-1234567-001"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Account login"
                      inputMode="numeric"
                      placeholder="e.g. 51234567"
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                      required
                    />
                    <Input
                      label="Server"
                      placeholder="e.g. Exness-Real1"
                      value={server}
                      onChange={(e) => setServer(e.target.value)}
                      required
                    />
                  </div>
                  <Input
                    type="password"
                    label="Password"
                    placeholder="Investor or master password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Use the investor (read-only) password to let the robot read your account, or the master password
                    for full trading access. Credentials are stored server-side and never shown in the browser.
                  </p>
                </>
              )}

              <Select
                label="Account type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as 'practice' | 'live')}
              >
                <option value="practice">Practice (demo)</option>
                <option value="live">Live</option>
              </Select>

              {broker.admin_referral_code && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Referral: <span className="font-mono text-foreground">{broker.admin_referral_code}</span>
                  <button
                    type="button"
                    onClick={() => void copyReferral()}
                    className="cursor-pointer text-muted-foreground transition-colors duration-150 hover:text-foreground"
                    aria-label="Copy admin referral code"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                </p>
              )}

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{error}</p>
              )}
              {success && (
                <p className="rounded-lg border border-up/30 bg-up/10 px-3 py-2 text-sm text-emerald-200">
                  <Check className="mr-1 inline h-4 w-4" aria-hidden="true" />
                  {success}
                </p>
              )}

              <Button type="submit" loading={busy} disabled={busy}>
                <PlugZap className="h-4 w-4" aria-hidden="true" />
                {isApi ? 'Verify & connect' : 'Save & connect'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

/* ------------------------------- REST API token ------------------------------ */

/**
 * Per-connection REST API token that the robot presents when trading (verified
 * server-side by the bridges). Only ever shows a masked preview — the raw token
 * is encrypted at rest and never leaves the server except over the authenticated
 * `get` call used by the robot adapter.
 */
/**
 * Admin: generate the platform's market-data source from the connected OANDA
 * broker trader account (no API key needed — quotes are fetched through the
 * broker). Shown on the OANDA card once an account is connected.
 */
function OandaMarketDataPanel() {
  const [provisioning, setProvisioning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const provision = async () => {
    setErr(null)
    setMsg(null)
    setProvisioning(true)
    const e = await provisionMarketDataFromBroker('oanda')
    setProvisioning(false)
    if (e) {
      setErr(e)
    } else {
      setMsg('OANDA is now the market data source — quotes & charts come from this account.')
      setTimeout(() => setMsg(null), 5000)
    }
  }

  return (
    <div className="mt-2 border-t border-up/20 pt-2">
      <p className="text-xs text-muted-foreground">
        Use this OANDA account as the platform&apos;s market data source — no API key needed.
      </p>
      <Button
        className="mt-2 w-full"
        variant="secondary"
        loading={provisioning}
        onClick={() => void provision()}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Use OANDA for market data
      </Button>
      {err && <p className="mt-1 text-xs text-red-300">{err}</p>}
      {msg && <p className="mt-1 text-xs text-emerald-200">{msg}</p>}
    </div>
  )
}

function RestApiTokenPanel({ connectionId }: { connectionId: string }) {
  const [status, setStatus] = useState<BrokerTokenStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'generate' | 'revoke' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetchBrokerTokenStatus(connectionId)
    setStatus(res)
    setLoading(false)
  }, [connectionId])

  useEffect(() => {
    void load()
  }, [load])

  const generate = async () => {
    setBusy('generate')
    setError(null)
    const { data, error: err } = await generateBrokerToken(connectionId)
    if (data) setStatus(data)
    if (err) setError(err)
    setBusy(null)
  }

  const revoke = async () => {
    setBusy('revoke')
    setError(null)
    const { error: err } = await revokeBrokerToken(connectionId)
    if (err) {
      setError(err)
    } else if (status) {
      setStatus({ ...status, hasToken: false, masked: null, created_at: null })
    }
    setBusy(null)
  }

  return (
    <div className="mt-2 border-t border-up/20 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <KeyRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          REST API token
        </p>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : status?.hasToken ? (
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {status.masked ?? '\u2026\u2026\u2026\u2026'}
            </code>
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy !== null}
              className="flex cursor-pointer items-center gap-1 text-xs text-red-300 transition-colors duration-150 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'revoke' ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              )}
              Revoke
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy !== null}
            className="flex cursor-pointer items-center gap-1 text-xs font-medium text-accent transition-colors duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'generate' ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-3 w-3" aria-hidden="true" />
            )}
            Generate token
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {status?.hasToken
          ? `The robot uses this token to trade this account${status.created_at ? ` (issued ${formatDateTime(status.created_at)})` : ''}.`
          : 'Generate a token so the robot can trade this account securely. Only a masked preview is shown here.'}
      </p>
      {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}

/* ----------------------------------- Page ---------------------------------- */

export function Brokers() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { brokers, connections, loading, refresh } = useBrokers(user?.id)
  const [connectId, setConnectId] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)

  const available = brokers.filter((b) => b.status === 'available')

  const openConnect = (id: string) => {
    setConnectId(id)
    requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const disconnect = async (id: string) => {
    await removeConnection(id)
    await refresh()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brokers"
        description={
          <>
            Browse the broker catalog and live status. Connect{' '}
            <span className="text-foreground">OANDA</span> with a REST API token, or a{' '}
            <span className="text-foreground">MetaTrader 4 / 5</span> account with your login, password and
            server for live trading through the MetaTrader bridge. Credentials are stored securely server-side and
            never shown in the browser.
          </>
        }
      />

      {user && available.length > 0 && (
        <div ref={panelRef} className="scroll-mt-24">
          <ConnectPanel
            brokers={available}
            connections={connections}
            selectedId={connectId}
            onSelect={setConnectId}
            onSaved={() => void refresh()}
          />
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {brokers.map((broker) => {
            const conn = connections.find((c) => c.broker_id === broker.id)
            const isAvailable = broker.status === 'available'
            const summary = connectionSummary(broker)
            const isMt = !broker.requires_api_key
            return (
              <Card key={broker.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">{broker.name}</CardTitle>
                  <Badge className={STATUS_STYLES[broker.status]}>{STATUS_LABEL[broker.status]}</Badge>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <p className="text-sm text-muted-foreground">{broker.description}</p>

                  <div className="rounded-lg border border-border bg-secondary/60 px-3 py-2.5">
                    <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                      {isMt ? (
                        <UserRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      ) : (
                        <KeyRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      )}
                      {summary.kind}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{summary.hint}</p>
                  </div>

                  {user &&
                    (conn ? (
                      <div className="rounded-lg border border-up/30 bg-up/10 px-3 py-2.5 text-sm text-emerald-200">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 font-medium">
                            <Check className="h-4 w-4" aria-hidden="true" />
                            Connected
                          </span>
                          <span className="text-xs text-emerald-200/70">
                            {conn.account_type} · {formatDateTime(conn.last_verified_at)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span className="truncate font-mono">
                            {conn.platform === 'mt4' || conn.platform === 'mt5'
                              ? `#${conn.account_id ?? '—'}${conn.server ? ` · ${conn.server}` : ''}`
                              : (conn.account_id ?? 'no account id')}
                          </span>
                          <button
                            type="button"
                            onClick={() => void disconnect(conn.id)}
                            className="flex cursor-pointer items-center gap-1 text-red-300 transition-colors duration-150 hover:text-red-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Disconnect
                          </button>
                        </div>
                        {(conn.platform === 'mt4' || conn.platform === 'mt5') && (
                          <div className="mt-2 border-t border-up/20 pt-2">
                            <MtConnectionStatus />
                          </div>
                        )}
                        <RestApiTokenPanel connectionId={conn.id} />
                        {conn.platform === 'oanda' && <OandaMarketDataPanel />}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not connected.</p>
                    ))}

                  <div className="mt-auto">
                    {isAvailable ? (
                      user ? (
                        <Button variant={conn ? 'secondary' : 'primary'} className="w-full" onClick={() => openConnect(broker.id)}>
                          <PlugZap className="h-4 w-4" aria-hidden="true" />
                          {conn ? 'Reconnect / edit' : 'Connect'}
                        </Button>
                      ) : (
                        <Link to="/auth" className="block">
                          <Button variant="primary" className="w-full">
                            <PlugZap className="h-4 w-4" aria-hidden="true" />
                            Sign in to connect
                          </Button>
                        </Link>
                      )
                    ) : (
                      <Button variant="secondary" className="w-full" disabled>
                        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                        Integration pending
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <p className={cn('text-xs text-muted-foreground')}>
        Admin referral codes are shown on each broker's connect form so you can register with the platform's code and
        get the best conditions.
      </p>
      {profile?.role === 'admin' && (
        <p className="text-xs text-muted-foreground">
          You're an admin — manage the broker catalog from the{' '}
          <Link to="/admin" className="text-accent hover:underline">
            Admin dashboard
          </Link>
          .
        </p>
      )}
    </div>
  )
}