/**
 * API tokens & integrations — the single place an admin manages every
 * third-party API token the app reads (MetaApi, OANDA, market-data providers,
 * news). Tokens are POSTed to the `admin-tokens` edge function, which verifies
 * the caller is a signed-in admin, live-validates each token against its
 * provider, and stores it in the project's Edge Function secrets via the
 * Supabase Management API — never in the database, never in the client bundle,
 * and never returned to the browser (only a masked preview + verdict).
 * Saved tokens are injected into the app automatically: the Edge Functions
 * read them via Deno.env.get() on the next call, so quotes, signals, the
 * robot and the news ticker pick them up within a minute — no redeploy.
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
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  TOKEN_DEFS,
  clearToken,
  fetchTokensConfig,
  saveTokens,
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
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
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

  const setInput = (name: string, value: string) =>
    setInputs((prev) => ({ ...prev, [name]: value }))

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
                API tokens are stored as encrypted Edge Function secrets and are only visible to the platform
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
          and are stored in <span className="font-medium text-foreground">Supabase Edge Function secrets</span> —
          never in the database and never kept in this browser after saving.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-up/30 bg-up/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-up" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">How saving works:</span> each token is encrypted at rest in
            the project's secret store, only the last few characters are ever shown back to you, and the app's edge
            functions pick it up automatically within a minute — quotes, signals, the robot and the news ticker start
            using it with no redeploy.
          </span>
        </div>

        <div className="space-y-3">
          {TOKEN_DEFS.map((def) => {
            const st = statuses[def.name]
            const value = inputs[def.name] ?? ''
            const show = !!visible[def.name]
            return (
              <div
                key={def.name}
                className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/20 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">{def.name}</span>
                    <Badge
                      className={
                        st?.configured
                          ? 'border-up/40 bg-up/10 text-up'
                          : 'border-border bg-muted text-muted-foreground'
                      }
                    >
                      {st?.configured ? 'Configured' : 'Not set'}
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
                  {st?.configured && (
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
