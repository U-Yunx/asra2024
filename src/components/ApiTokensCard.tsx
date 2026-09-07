/**
 * API tokens & integrations — the single place an admin manages every
 * third-party API token the app reads (Supabase, MetaApi, OANDA, market-data
 * providers, news). Saving is now fully automatic:
 *
 *   • One click on "Generate & inject automatically" uses the admin's signed-in
 *     session to generate + inject the Supabase API token into the app's secure
 *     service-role store (RLS-locked, `app_secrets`) — no Personal Access Token
 *     and no Supabase dashboard visit required.
 *   • Pasted tokens are POSTed to the `admin-tokens` edge function, which
 *     verifies the caller is a signed-in admin, live-validates each token
 *     against its provider, and stores it in the same secure store — never in
 *     the client bundle, never returned to the browser (only a masked preview +
 *     verdict).
 *   • Saved tokens are injected into the app automatically: the Edge Functions
 *     read them from the store on their next call, so quotes, signals, the
 *     robot and the news ticker pick them up immediately — no redeploy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  TOKEN_DEFS,
  bootstrapTokens,
  clearToken,
  fetchTokensConfig,
  saveTokens,
  type BootstrapInfo,
  type TokenStatus,
} from '../lib/tokens'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from './ui'
import { cn } from '../lib/cn'

const EMPTY_STATUS: Record<string, TokenStatus> = Object.fromEntries(
  TOKEN_DEFS.map((t) => [t.name, { name: t.name, label: t.label, configured: false, masked: null }]),
)

export function ApiTokensCard() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [statuses, setStatuses] = useState<Record<string, TokenStatus>>(EMPTY_STATUS)
  const [boot, setBoot] = useState<BootstrapInfo | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [saving, setSaving] = useState<string | null>(null) // token name being saved, or 'ALL'
  const [clearing, setClearing] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const res = await fetchTokensConfig()
    setLoading(false)
    if (res.error) {
      // 403 "Admins only" arrives as an error — surface it as the locked state.
      if (/admins only/i.test(res.error)) {
        setIsAdmin(false)
        return
      }
      setErr(res.error)
      return
    }
    const next = { ...EMPTY_STATUS }
    for (const t of res.data?.tokens ?? []) next[t.name] = t
    setStatuses(next)
    setBoot(res.data?.bootstrap ?? null)
  }, [])

  // Gate: admins only (the edge function re-enforces this on every call).
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (alive) setIsAdmin(false)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      if (alive) setIsAdmin((data as { role?: string } | null)?.role === 'admin')
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (isAdmin === true) void load()
  }, [isAdmin, load])

  const filledCount = useMemo(
    () => TOKEN_DEFS.filter((t) => (inputs[t.name] ?? '').trim().length > 0).length,
    [inputs],
  )

  /** True once the one-click bootstrap has run — token storage needs no PAT. */
  const autoManaged = boot?.mode === 'auto'
  const masterConfigured = statuses.SUPABASE_ACCESS_TOKEN?.configured ?? false

  const setInput = (name: string, value: string) =>
    setInputs((prev) => ({ ...prev, [name]: value }))

  /**
   * One-click "generate & inject automatically": the server uses the admin's
   * signed-in session to generate + inject the Supabase API token into the
   * secure store, verify it, and ensure the robot's cron token exists.
   */
  const bootstrap = async () => {
    setBootstrapping(true)
    setErr(null)
    setMsg(null)
    const res = await bootstrapTokens()
    setBootstrapping(false)
    if (res.error) {
      setErr(res.error)
      return
    }
    if (res.data?.tokens) {
      const next = { ...EMPTY_STATUS }
      for (const t of res.data.tokens) next[t.name] = t
      setStatuses(next)
      setBoot({ mode: 'auto', verified: true, robot_token: 'present', bootstrapped_at: new Date().toISOString() })
    }
    setMsg(
      res.data?.message ??
        'Supabase API token generated & injected from your session — token storage is live. Save any provider key below and the app + robot pick it up immediately.',
    )
  }

  /** Persist the given tokens, apply verdicts, then refetch the masked status. */
  const persist = async (tokens: { name: string; value: string }[]) => {
    if (tokens.length === 0) return
    setErr(null)
    setMsg(null)
    const res = await saveTokens(tokens)
    if (res.error) {
      setErr(res.error)
      setSaving(null)
      return
    }
    const verdicts: string[] = []
    for (const r of res.data?.results ?? []) {
      if (r.saved) {
        setInputs((prev) => ({ ...prev, [r.name]: '' }))
        verdicts.push(
          r.validation?.ok
            ? `${r.label} — saved & validated ✓`
            : `${r.label} — saved, but ${r.validation?.error ?? 'the provider could not verify it'}`,
        )
      } else {
        verdicts.push(`${r.label} — not saved: ${r.error ?? 'unknown error'}`)
      }
    }
    setMsg(verdicts.join(' · '))
    setSaving(null)
    // Refetch so the masked previews come from the server (authoritative).
    void load()
  }

  const saveOne = async (name: string) => {
    const value = (inputs[name] ?? '').trim()
    if (!value) return
    setSaving(name)
    await persist([{ name, value }])
  }

  const saveAll = async () => {
    const toSave = TOKEN_DEFS.filter((t) => (inputs[t.name] ?? '').trim().length > 0).map((t) => ({
      name: t.name,
      value: inputs[t.name].trim(),
    }))
    if (toSave.length === 0) return
    setSaving('ALL')
    await persist(toSave)
  }

  const clearOne = async (name: string) => {
    setClearing(name)
    setErr(null)
    const res = await clearToken(name)
    setClearing(null)
    if (res.error) {
      setErr(res.error)
      return
    }
    setStatuses((prev) => ({
      ...prev,
      [name]: { ...prev[name], configured: false, masked: null },
    }))
    setMsg(`${TOKEN_DEFS.find((t) => t.name === name)?.label ?? name} removed — the app falls back to other sources.`)
  }

  if (isAdmin === null) {
    return (
      <Card className="lg:col-span-2">
        <CardContent>
          <div className="h-40 animate-pulse rounded-lg border border-border bg-secondary/40" />
        </CardContent>
      </Card>
    )
  }

  if (isAdmin === false) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" aria-hidden="true" />
            API tokens &amp; integrations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-4">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Admins only</p>
              <p className="mt-1 text-xs text-muted-foreground">
                API tokens are stored in the app's secure service-role store and are only visible to the platform
                administrators. Ask an admin to set them up.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" aria-hidden="true" />
          API tokens &amp; integrations
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          One place to input every token the app uses. Tokens go straight to the edge function, are validated live,
          and are stored in the app's <span className="font-medium text-foreground">secure service-role store</span> —
          never in the client bundle and never kept in this browser after saving.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-up/30 bg-up/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-up" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">How saving works:</span> every token is stored encrypted at
            rest in the platform's RLS-locked secret store (only the app's edge functions can read it), only the last
            few characters are ever shown back to you, and the app's edge functions pick it up automatically within a
            minute — quotes, signals, the robot and the news ticker start using it with no redeploy.
          </span>
        </div>

        {!loading && autoManaged && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-xs leading-relaxed text-up">
            <Zap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium">Token storage auto-configured.</span> The Supabase API token was generated
              &amp; injected from your session — no dashboard, no Personal Access Token. Save any provider key below and
              it becomes live immediately.
            </span>
          </div>
        )}

        {!loading && !autoManaged && !masterConfigured && (
          <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <span>
                  <span className="font-medium">One click to start.</span> Generate &amp; inject the Supabase API token
                  automatically using your signed-in session — the app and robot then use every token you save below,
                  with no manual setup.
                </span>
              </div>
              <Button onClick={() => void bootstrap()} loading={bootstrapping} className="shrink-0">
                <Zap className="h-4 w-4" aria-hidden="true" />
                Generate &amp; inject automatically
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {TOKEN_DEFS.map((def) => {
            const st = statuses[def.name]
            const value = inputs[def.name] ?? ''
            const show = !!visible[def.name]
            const autoMaster = !!st?.autoManaged
            return (
              <div
                key={def.name}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center',
                  def.master ? 'border-accent/40 bg-accent/5' : 'border-border bg-secondary/20',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">{def.name}</span>
                    {def.master && !autoMaster && (
                      <Badge className="border-accent/40 bg-accent/10 text-accent">Master key</Badge>
                    )}
                    {autoMaster && (
                      <Badge className="border-up/40 bg-up/10 text-up">Auto-managed</Badge>
                    )}
                    <Badge
                      className={
                        st?.configured
                          ? 'border-up/40 bg-up/10 text-up'
                          : 'border-border bg-muted text-muted-foreground'
                      }
                    >
                      {st?.configured ? (autoMaster ? 'Active' : 'Configured') : 'Not set'}
                    </Badge>
                    <a
                      href={def.signupUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                      Get a key <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{def.description}</p>
                  {st?.configured && st.masked && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground/70">Stored: {st.masked}</p>
                  )}
                  {autoMaster && !st?.masked && (
                    <p className="mt-1 text-xs text-up/80">
                      Auto-generated from your signed-in session — managed by the platform.
                    </p>
                  )}
                </div>

                <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
                  <div className="relative flex-1 sm:w-72">
                    <input
                      type={show ? 'text' : 'password'}
                      value={value}
                      onChange={(e) => setInput(def.name, e.target.value)}
                      placeholder={st?.configured ? 'Paste a new key to replace it…' : 'Paste your key…'}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`${def.label} API key`}
                      className={cn(
                        'w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 text-sm text-foreground placeholder:text-muted-foreground/60',
                        'transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setVisible((prev) => ({ ...prev, [def.name]: !prev[def.name] }))}
                      aria-label={show ? `Hide ${def.label} key` : `Show ${def.label} key`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                    >
                      {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                  <Button size="sm" onClick={() => void saveOne(def.name)} disabled={value.trim().length === 0} loading={saving === def.name}>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    Save
                  </Button>
                  {st?.configured && def.canClear !== false && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void clearOne(def.name)}
                      loading={clearing === def.name}
                      aria-label={`Remove ${def.label} key`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button onClick={() => void saveAll()} loading={saving === 'ALL'} disabled={filledCount === 0}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save {filledCount > 0 ? `${filledCount} token${filledCount === 1 ? '' : 's'}` : 'tokens'}
          </Button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary/40 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground active:scale-[0.97]"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Check status
          </button>
        </div>

        {loading && (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            Refreshing status…
          </p>
        )}
        {msg && <p className="mt-3 rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">{msg}</p>}
        {err && (
          <p className="mt-3 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">{err}</p>
        )}
      </CardContent>
    </Card>
  )
}
