/**
 * API tokens & integrations — the frontend contract for the `admin-tokens`
 * edge function. Tokens are never stored client-side; the browser only ever
 * sees a masked preview and a configured/not-configured flag, plus the verdict
 * from a live validation that the edge function runs server-side.
 */
import { fn } from './functions'

export interface TokenDef {
  /** Edge Function secret name (SCREAMING_SNAKE_CASE). */
  name: string
  /** Human label shown in the UI. */
  label: string
  /** What the token powers. */
  description: string
  /** Where the admin gets the token. */
  signupUrl: string
  /** Master key that unlocks saving every other token — highlighted in the UI. */
  master?: boolean
  /** When false the UI offers replace-only (no delete) — rotation happens by pasting a new value. */
  canClear?: boolean
}

/** Every third-party token the app's Edge Functions read via Deno.env.get. */
export const TOKEN_DEFS: TokenDef[] = [
  {
    name: 'SUPABASE_ACCESS_TOKEN',
    label: 'Supabase API token',
    description:
      'Auto-managed — generated & injected from your signed-in session with one click, no dashboard needed. Optional: paste a Personal Access Token (sbp_…) to also mirror tokens to the platform secret store.',
    signupUrl: 'https://supabase.com/dashboard/account/tokens',
    master: true,
    canClear: false,
  },
  {
    name: 'METAAPI_TOKEN',
    label: 'MetaApi',
    description: 'MetaTrader 4/5 bridge — powers live MT broker connections on the Brokers page.',
    signupUrl: 'https://metaapi.cloud',
  },
  {
    name: 'OANDA_API_KEY',
    label: 'OANDA',
    description: 'OANDA v20 REST — broker trader account and OANDA market data.',
    signupUrl: 'https://www.oanda.com',
  },
  {
    name: 'TWELVE_DATA_API_KEY',
    label: 'Twelve Data',
    description: 'Market data for quotes, charts, signals & backtests — also powers the news ticker.',
    signupUrl: 'https://twelvedata.com',
  },
  {
    name: 'FINNHUB_API_KEY',
    label: 'Finnhub',
    description: 'Alternative market data provider (forex + crypto quotes).',
    signupUrl: 'https://finnhub.io',
  },
  {
    name: 'ALPHA_VANTAGE_API_KEY',
    label: 'Alpha Vantage',
    description: 'Alternative market data provider (forex rates).',
    signupUrl: 'https://www.alphavantage.co',
  },
  {
    name: 'POLYGON_API_KEY',
    label: 'Polygon.io',
    description: 'Alternative market data provider (crypto + stocks).',
    signupUrl: 'https://polygon.io',
  },
]

export interface TokenStatus {
  name: string
  label: string
  configured: boolean
  masked: string | null
  /** True when the master token is managed automatically (no PAT required). */
  autoManaged?: boolean
}

/** One-click auto token-store state returned by the admin-tokens function. */
export interface BootstrapInfo {
  mode: 'auto' | 'manual'
  verified: boolean
  robot_token: 'present' | 'missing'
  bootstrapped_at: string | null
}

export interface SaveTokenResult {
  name: string
  label: string
  saved: boolean
  validation: { ok: boolean; error?: string } | null
  error?: string | null
}

export async function fetchTokensConfig(): Promise<{
  data: { tokens: TokenStatus[]; bootstrap: BootstrapInfo | null } | null
  error: string | null
}> {
  return fn<{ tokens: TokenStatus[]; bootstrap: BootstrapInfo | null }>('admin-tokens', {
    body: { action: 'tokens-config' },
    fallback: 'Could not load token status.',
  })
}

/**
 * One-click "generate & inject automatically": the server uses the caller's
 * signed-in session to generate + inject a fresh Supabase API token into the
 * secure store, verify it with a round-trip, ensure the robot's cron token
 * exists, and mark the store auto-managed. No Personal Access Token needed.
 */
export async function bootstrapTokens(): Promise<{
  data: { ok: boolean; mode?: string; verified?: boolean; message?: string; tokens?: TokenStatus[] } | null
  error: string | null
}> {
  return fn<{ ok: boolean; mode?: string; verified?: boolean; message?: string; tokens?: TokenStatus[] }>(
    'admin-tokens',
    {
      body: { action: 'tokens-bootstrap' },
      fallback: 'Could not auto-configure the Supabase API token.',
    },
  )
}

export async function saveTokens(
  tokens: { name: string; value: string }[],
): Promise<{ data: { results: SaveTokenResult[] } | null; error: string | null }> {
  return fn<{ results: SaveTokenResult[] }>('admin-tokens', {
    body: { action: 'tokens-set', tokens },
    fallback: 'Could not save tokens.',
  })
}

export async function clearToken(name: string): Promise<{ data: { ok: boolean } | null; error: string | null }> {
  return fn<{ ok: boolean }>('admin-tokens', {
    body: { action: 'tokens-clear', name },
    fallback: 'Could not remove the token.',
  })
}
