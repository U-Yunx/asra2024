import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

// ---------------------------------------------------------------------------
// Market data proxy for the FX Toolkit.
//
// The browser NEVER talks to a market-data provider directly. This function
// holds each provider's API key as a secret, proxies requests server-side, and
// caches responses so dashboard polling and repeated signals don't burn the
// free-tier credit budget.
//
// v11 — multiple providers + automatic fallback + one-click free source:
//   * A small provider registry (Twelve Data = default, Finnhub, Alpha Vantage,
//     Polygon.io) plus a free keyless source (Binance public API for crypto +
//     Yahoo Finance for FX) and a broker-derived source (OANDA — auto-generated
//     from the admin's broker trader account on the Brokers page) lets an admin
//     pick which provider feeds the platform.
//   * Any signed-in user can activate the free source from the Configuration
//     page (`activate_free`) — no signup, no API key. It never overrides a
//     provider that already has a stored key: the free source simply stays the
//     automatic fallback in that case.
//   * Each provider's API key is stored server-side in `app_secrets` under
//     `market_data_<provider>`, and the active provider is recorded in
//     `market_data_provider`. Keys are never exposed to the browser.
//   * Quotes / time-series route through an automatic fallback chain: the
//     selected provider is tried first, then other configured keyed providers,
//     then free keyless sources. If the active provider stops working (expired
//     key, rate limit, upstream error) the next usable provider serves the
//     request and is persisted as the new active one, so the platform keeps
//     serving market data without manual intervention.
//   * The cache is namespaced per provider so switching never serves the other
//     provider's data, and the shared rate gate + in-memory bucket stay as-is.
// ---------------------------------------------------------------------------

// Same 18-symbol watchlist as src/lib/watchlist.ts (kept in sync).
const WATCHLIST = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "AUD/USD",
  "NZD/USD",
  "USD/CAD",
  "EUR/GBP",
  "EUR/JPY",
  "GBP/JPY",
  "BTC/USD",
  "ETH/USD",
  "BNB/USD",
  "SOL/USD",
  "XRP/USD",
  "ADA/USD",
  "DOGE/USD",
  "LTC/USD",
];

const VALID_INTERVALS = ["1min", "5min", "15min", "30min", "1h", "4h", "1day"];
const TD_BASE = "https://api.twelvedata.com";
const FH_BASE = "https://finnhub.io/api/v1";
const AV_BASE = "https://www.alphavantage.co/query";
const POLY_BASE = "https://api.polygon.io";
const YH_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const BN_BASE = "https://api.binance.com/api/v3";
const OANDA_PRACTICE = "https://api-fxpractice.oanda.com";
const OANDA_LIVE = "https://api-fxtrade.oanda.com";
const MAX_OUTPUTSIZE = 5000;

interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  percent_change: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previous_close: number | null;
  is_market_open: boolean | null;
  datetime: string | null;
  stale?: boolean;
  error?: string | null;
}

interface Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// --- Persistent cache (Supabase market_cache table) --------------------------
// The admin client bypasses RLS (service-role / secret key only, never exposed
// to the browser). The small in-memory Map is a per-instance L1; the DB is the
// authoritative L2 that survives cold starts and is shared across instances.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ADMIN_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  (() => {
    try {
      const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, unknown>;
      return (keys["default"] as string) ?? "";
    } catch {
      return "";
    }
  })();
const admin = ADMIN_KEY ? createClient(SUPABASE_URL, ADMIN_KEY) : null;

const memoryCache = new Map<string, { at: number; value: unknown }>();

// Interval TTLs — how long a time-series response is considered fresh. 1/5min
// bars live for 5 minutes so the auto-robot reuses cached bars between ticks
// instead of spending an upstream credit on every evaluation.
const TTL_MS: Record<string, number> = {
  "1min": 5 * 60_000,
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "1h": 30 * 60_000,
  "4h": 30 * 60_000,
  "1day": 12 * 60 * 60_000,
};
// Keyed providers: keep quotes fresh for 5 minutes — a full 18-symbol rotation
// at 2 symbols/request fits comfortably inside the shared 8/min credit gate.
const QUOTES_FRESH_MS = 300_000;
// Free keyless source: quotes go stale after a few seconds so the watchlist
// actually fluctuates in real time. Crypto refreshes in one batched Binance
// call (cheap, no key, no credit cost) and FX rotates through Yahoo.
const QUOTES_FRESH_FREE_MS = 6_000;
const FREE_BATCH_MIN_MS = 4_000; // min gap between full crypto batch refreshes (per instance)
const FREE_FX_BUDGET = 2; // max FX symbols refreshed per request via Yahoo
// Upstream rate limiter — conservative cap shared by all providers.
const RATE_MAX = 8;
const RATE_WINDOW_MS = 60_000;
// How many of the oldest-stale quotes to refresh per request (staggered).
const QUOTES_REFRESH_BUDGET = 2;

let tokens = RATE_MAX;
let lastRefill = Date.now();
let lastFreeBatchAt = 0;

/** Token-bucket (per-instance, fast): returns true if one credit is available. */
function canUseCredit(): boolean {
  const now = Date.now();
  tokens = Math.min(RATE_MAX, tokens + ((now - lastRefill) / RATE_WINDOW_MS) * RATE_MAX);
  lastRefill = now;
  if (tokens >= 1) {
    tokens -= 1;
    return true;
  }
  return false;
}

/**
 * Per-instance throttle for the free source: a full crypto batch refresh runs
 * at most once every few seconds. Binance's public market-data limits are in
 * the hundreds of calls/minute at ~4 weight/symbol, so even a handful of
 * concurrent instances stay comfortably inside them.
 */
function canUseFreeBatch(): boolean {
  const now = Date.now();
  if (now - lastFreeBatchAt < FREE_BATCH_MIN_MS) return false;
  lastFreeBatchAt = now;
  return true;
}

// --- Shared upstream gate ----------------------------------------------------
// A single `market_cache` row (`meta:upstream_gate`) is used as a mutex so
// concurrent Edge Function instances can't collectively blow past the upstream
// per-account limit. At most one upstream call is allowed per interval.
const GATE_KEY = "meta:upstream_gate";
const GATE_INTERVAL_MS = Math.max(1000, Math.floor(RATE_WINDOW_MS / RATE_MAX)); // ~7.5s

async function claimUpstreamSlot(): Promise<boolean> {
  if (!admin) return true; // no DB access → fall back to the per-instance bucket
  const now = new Date();
  const cutoff = new Date(now.getTime() - GATE_INTERVAL_MS).toISOString();

  // Atomic claim: advance the timestamp only if it's older than the interval.
  const { data, error } = await admin
    .from("market_cache")
    .update({ updated_at: now.toISOString() })
    .eq("cache_key", GATE_KEY)
    .lt("updated_at", cutoff)
    .select("cache_key");
  if (error) return true; // fail-open on DB errors (per-instance bucket still applies)
  if (data && data.length > 0) return true;

  // Either the gate is too recent, or it doesn't exist yet. If it doesn't
  // exist, create it and claim the first slot.
  const { data: exists } = await admin
    .from("market_cache")
    .select("cache_key")
    .eq("cache_key", GATE_KEY)
    .maybeSingle();
  if (!exists) {
    const { error: insErr } = await admin
      .from("market_cache")
      .upsert(
        { cache_key: GATE_KEY, payload: { at: now.toISOString() }, updated_at: now.toISOString() },
        { onConflict: "cache_key" },
      );
    return !insErr;
  }
  return false;
}

interface CacheRow {
  payload: unknown;
  updated_at: string;
}

async function cacheGetMany(keys: string[]): Promise<Map<string, CacheRow>> {
  const out = new Map<string, CacheRow>();
  if (!admin || keys.length === 0) return out;
  const { data } = await admin
    .from("market_cache")
    .select("cache_key,payload,updated_at")
    .in("cache_key", keys);
  for (const row of data ?? []) {
    out.set(row.cache_key, { payload: row.payload, updated_at: row.updated_at });
  }
  return out;
}

async function cacheSet(key: string, payload: unknown): Promise<void> {
  if (!admin) return;
  memoryCache.set(key, { at: Date.now(), value: payload });
  await admin
    .from("market_cache")
    .upsert({ cache_key: key, payload, updated_at: new Date().toISOString() }, { onConflict: "cache_key" });
}

// --- Provider registry ------------------------------------------------------
// Each supported provider knows its display label, the app_secrets key its API
// key is stored under, the env-var fallback, how to validate a key, and how to
// fetch quotes / time-series. The active provider is recorded in app_secrets
// under `market_data_provider` (default: twelvedata).

interface MarketProvider {
  id: string;
  label: string;
  signupUrl: string;
  envKey: string;
  /** True when this provider needs no API key (free fallback source). */
  keyless?: boolean;
  /** Where the data comes from: keyed API, free keyless source, or a broker trader account. */
  source?: "keyed" | "keyless" | "broker";
  validate: (apiKey: string) => Promise<string | null>;
  fetchQuote: (apiKey: string, symbol: string) => Promise<Quote>;
  fetchTimeSeries: (
    apiKey: string,
    symbol: string,
    interval: string,
    outputsize: number,
    startDate?: string,
    endDate?: string,
  ) => Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }>;
}

let apiKeyCache: { provider: string; key: string; at: number } | null = null;

/** Read the selected provider id from app_secrets (falls back to twelvedata). */
async function resolveSelectedProvider(): Promise<string> {
  if (admin) {
    try {
      const { data } = await admin
        .from("app_secrets")
        .select("value")
        .eq("key", "market_data_provider")
        .maybeSingle();
      const v = data?.value;
      if (typeof v === "string" && v && PROVIDERS[v]) return v;
    } catch {
      // fall through to default
    }
  }
  return "twelvedata";
}

/**
 * Resolve a provider's API key. Precedence:
 *   1. app_secrets.market_data_<provider> — set by an admin from the Admin →
 *      Settings UI (service-role only, never exposed to the browser).
 *   2. The provider's Edge Function env secret (the default / fallback).
 * Resolved per request (briefly cached) so an admin key change takes effect
 * immediately without redeploying the function.
 */
async function resolveApiKey(providerId: string): Promise<string | null> {
  const now = Date.now();
  if (apiKeyCache && apiKeyCache.provider === providerId && now - apiKeyCache.at < 60_000) {
    return apiKeyCache.key;
  }

  let key: string | null = null;
  if (admin) {
    try {
      const { data } = await admin
        .from("app_secrets")
        .select("value")
        .eq("key", `market_data_${providerId}`)
        .maybeSingle();
      const v = data?.value;
      if (typeof v === "string" && v.trim()) key = v.trim();
    } catch {
      // fall through to the env secret
    }
  }
  if (!key) {
    const env = Deno.env.get(PROVIDERS[providerId].envKey);
    if (env && env.trim()) key = env.trim();
  }
  apiKeyCache = key ? { provider: providerId, key, at: now } : null;
  return key;
}

/** True only for a signed-in user whose profile role is `admin`. */
async function isAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.sub !== "string" || !admin) return false;
  try {
    const { data } = await admin.from("profiles").select("role").eq("id", payload.sub).maybeSingle();
    return data?.role === "admin";
  } catch {
    return false;
  }
}

/** True when the request carries a real user session JWT (has a `sub` claim). */
function hasSession(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const payload = decodeJwtPayload(authHeader.slice("Bearer ".length).trim());
  return !!payload && typeof payload.sub === "string" && payload.sub.length > 0;
}

/**
 * The first provider in the fallback chain that can actually serve data right
 * now (keyless, or with a stored key). This is the "live" source the UI shows —
 * it differs from the selected provider when that one can't serve (no key yet,
 * expired key, etc.).
 */
async function resolveActiveProvider(): Promise<{ id: string | null; label: string | null }> {
  const chain = await resolveProviderChain();
  for (const id of chain) {
    const p = PROVIDERS[id];
    if (p.keyless || !!(await resolveApiKey(id))) {
      return { id, label: p.label };
    }
  }
  return { id: null, label: null };
}

/** Shared config snapshot: selected provider, key state, and live source. */
async function configSummary(): Promise<Record<string, unknown>> {
  const selected = await resolveSelectedProvider();
  const chain = await resolveProviderChain();
  const active = await resolveActiveProvider();
  const providers = await Promise.all(
    Object.values(PROVIDERS).map(async (p) => ({
      id: p.id,
      label: p.label,
      configured: p.keyless ? true : !!(await resolveApiKey(p.id)),
      keyless: !!p.keyless,
      source: p.source ?? (p.keyless ? "keyless" : "keyed"),
    })),
  );
  return {
    provider: selected,
    provider_label: PROVIDERS[selected]?.label ?? "Twelve Data",
    configured: providers.find((p) => p.id === selected)?.configured ?? false,
    providers,
    active_provider: active.id ?? selected,
    active_provider_label: active.label,
    fallback_available: chain.length > 1,
  };
}

/** Report the selected provider, key state, keyless/broker flags, and active provider. */
async function handleMarketConfig(): Promise<Response> {
  return json(await configSummary());
}

/**
 * One-click free market data (any signed-in user, from the Configuration page):
 * makes the built-in keyless source (Binance for crypto + Yahoo for FX) the
 * app's main market data API — no signup, no API key, $0 forever. It never
 * overrides a provider that already has an API key stored; the free source
 * stays the automatic fallback in that case.
 */
async function handleActivateFree(): Promise<Response> {
  if (!admin) return json({ error: "internal", message: "Market data service is not configured." }, 500);
  for (const id of Object.keys(PROVIDERS)) {
    const p = PROVIDERS[id];
    if (p.keyless) continue;
    if (await resolveApiKey(id)) {
      return json({
        error: "already_configured",
        message: `Your platform is already on ${p.label} — free market data stays available as its automatic fallback.`,
      });
    }
  }
  await admin.from("app_secrets").upsert({ key: "market_data_provider", value: "yahoo" }, { onConflict: "key" });
  apiKeyCache = null;
  return json({
    ok: true,
    message: "Free market data is now the main source — quotes, charts and the robot use it automatically.",
    ...(await configSummary()),
  });
}

/** Admin: generate the market data source from the caller's OANDA broker trader account. */
async function handleSetBrokerSource(req: Request): Promise<Response> {
  if (!admin) return json({ error: "internal", message: "Market data service is not configured." }, 500);
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.sub === "string" ? payload.sub : "";
  if (!userId) return json({ error: "unauthorized" }, 401);

  // The caller's saved OANDA broker connection (same flow the Brokers page uses).
  const { data: broker } = await admin
    .from("brokers")
    .select("id, slug, live_url, practice_url")
    .eq("slug", "oanda")
    .maybeSingle();
  if (!broker) return json({ error: "bad_request", message: "OANDA is not in the broker catalog." }, 400);

  const { data: conn } = await admin
    .from("broker_connections")
    .select("api_key, account_id, account_type")
    .eq("user_id", userId)
    .eq("broker_id", broker.id)
    .maybeSingle();
  if (!conn?.api_key) {
    return json({ error: "bad_request", message: "Connect your OANDA broker trader account on the Brokers page first." }, 400);
  }

  const { data: decrypted, error: decryptErr } = await admin.rpc("decrypt_broker_cred", { p_enc: conn.api_key });
  if (decryptErr || !decrypted) {
    return json({ error: "internal", message: "Could not read your broker credentials." }, 500);
  }
  const apiKey = String(decrypted);
  const accountId = String(conn.account_id ?? "");
  if (!accountId) {
    return json({ error: "bad_request", message: "Add an OANDA account id on the Brokers page so market data can be generated." }, 400);
  }
  const base = conn.account_type === "live" ? broker.live_url : broker.practice_url;

  // Validate the account actually serves pricing before storing it.
  const probe = await fetch(`${base}/v3/accounts/${encodeURIComponent(accountId)}/pricing?instruments=EUR_USD`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!probe.ok) {
    return json({ error: "bad_request", message: "OANDA rejected this account — check the API token and account id." }, 400);
  }

  await admin.from("app_secrets").upsert({ key: "market_data_oanda", value: apiKey }, { onConflict: "key" });
  await admin.from("app_secrets").upsert({ key: "market_data_oanda_account", value: accountId }, { onConflict: "key" });
  await admin.from("app_secrets").upsert(
    { key: "market_data_oanda_env", value: conn.account_type === "live" ? "live" : "practice" },
    { onConflict: "key" },
  );

  // Make OANDA the active provider only if nothing else is configured with a key.
  const selected = await resolveSelectedProvider();
  const selectedKey = await resolveApiKey(selected);
  let activated = false;
  if (selected === "oanda" || !selectedKey) {
    await admin.from("app_secrets").upsert({ key: "market_data_provider", value: "oanda" }, { onConflict: "key" });
    activated = true;
  }
  apiKeyCache = null;
  return json({
    ok: true,
    provider: "oanda",
    provider_label: PROVIDERS.oanda?.label ?? "OANDA",
    activated,
    market_data_ready: true,
  });
}

// --- Automatic fallback chain ------------------------------------------------
// Try the selected provider first, then any other configured keyed providers,
// then free keyless sources (Yahoo). The first provider that returns usable data
// wins, and if it isn't the configured one it is promoted to active so the
// platform "uses it as the application market data API" going forward.

let lastPromotion: { id: string; at: number } | null = null;
const PROMOTION_COOLDOWN_MS = 120_000;

async function resolveProviderChain(): Promise<string[]> {
  const selected = await resolveSelectedProvider();
  const chain: string[] = [];
  const push = (id: string) => {
    if (!chain.includes(id)) chain.push(id);
  };
  push(selected);
  for (const id of Object.keys(PROVIDERS)) {
    if (id === selected) continue;
    const p = PROVIDERS[id];
    if (p.keyless) continue;
    if (await resolveApiKey(id)) push(id);
  }
  for (const id of Object.keys(PROVIDERS)) {
    if (id === selected || chain.includes(id)) continue;
    if (PROVIDERS[id].keyless) push(id);
  }
  return chain;
}

async function maybePromoteProvider(providerId: string): Promise<void> {
  if (!admin) return;
  const now = Date.now();
  if (lastPromotion && lastPromotion.id === providerId && now - lastPromotion.at < PROMOTION_COOLDOWN_MS) return;
  lastPromotion = { id: providerId, at: now };
  try {
    await admin.from("app_secrets").upsert({ key: "market_data_provider", value: providerId }, { onConflict: "key" });
  } catch {
    // non-fatal
  }
}

async function handleQuotesWithFallback(chain: string[], priority: string[]): Promise<Response> {
  let lastError: { error: string; message?: string } | null = null;
  for (const providerId of chain) {
    const provider = PROVIDERS[providerId];
    const apiKey = provider.keyless ? "" : (await resolveApiKey(providerId)) ?? "";
    if (!provider.keyless && !apiKey) {
      lastError = { error: "no_api_key" };
      continue;
    }
    const res = await handleQuotes(providerId, apiKey, priority);
    const body = (await res.json().catch(() => ({ error: "upstream" }))) as {
      error?: string;
      message?: string;
      quotes?: Quote[];
      anyStale?: boolean;
    };
    if (!body.error && Array.isArray(body.quotes) && body.quotes.length > 0) {
      if (providerId !== chain[0]) await maybePromoteProvider(providerId);
      return json({
        quotes: body.quotes,
        anyStale: body.anyStale ?? false,
        provider: providerId,
        provider_label: provider.label,
        source: provider.source ?? "keyed",
      });
    }
    lastError = { error: body.error ?? "upstream", message: body.message };
  }
  return json(lastError ?? { error: "upstream", message: "Market data is unavailable right now." });
}

async function handleTimeSeriesWithFallback(chain: string[], body: Record<string, unknown>): Promise<Response> {
  let lastError: { error: string; message?: string } | null = null;
  for (const providerId of chain) {
    const provider = PROVIDERS[providerId];
    const apiKey = provider.keyless ? "" : (await resolveApiKey(providerId)) ?? "";
    if (!provider.keyless && !apiKey) {
      lastError = { error: "no_api_key" };
      continue;
    }
    const res = await handleTimeSeries(providerId, apiKey, body);
    const parsed = (await res.json().catch(() => ({ error: "upstream" }))) as {
      error?: string;
      message?: string;
      bars?: Bar[];
      stale?: boolean;
    };
    if (!parsed.error && Array.isArray(parsed.bars)) {
      if (providerId !== chain[0]) await maybePromoteProvider(providerId);
      return json({
        bars: parsed.bars,
        stale: parsed.stale ?? false,
        provider: providerId,
        provider_label: provider.label,
        source: provider.source ?? "keyed",
      });
    }
    lastError = { error: parsed.error ?? "upstream", message: parsed.message };
  }
  return json(lastError ?? { error: "upstream", message: "Market data is unavailable right now." });
}

/** Admin: validate and store a provider API key + make it the active provider. */
async function handleSetApiKey(body: Record<string, unknown>): Promise<Response> {
  const providerId = String(body.provider ?? "twelvedata");
  const provider = PROVIDERS[providerId];
  if (!provider) return json({ error: "bad_request", message: "Unknown market data provider." }, 400);

  if (provider.keyless) {
    return json({ error: "bad_request", message: `${provider.label} needs no API key — it's a free, keyless source.` }, 400);
  }
  if (provider.source === "broker") {
    return json({ error: "bad_request", message: "This source is generated from your broker trader account on the Brokers page — no key to paste here." }, 400);
  }

  const value = String(body.api_key ?? "").trim();
  if (!value) return json({ error: "bad_request", message: "Enter the API key." }, 400);
  if (value.length < 8) {
    return json({ error: "bad_request", message: `That doesn't look like a valid ${provider.label} API key.` }, 400);
  }

  // Validate against the provider. If the network hiccups we still save — it
  // may be reachable from production even when this check fails.
  const validationError = await provider.validate(value);
  if (validationError) {
    return json({ error: "invalid_key", message: validationError }, 400);
  }

  if (!admin) return json({ error: "internal", message: "Market data service is not configured." }, 500);
  const { error } = await admin
    .from("app_secrets")
    .upsert({ key: `market_data_${providerId}`, value }, { onConflict: "key" });
  if (error) return json({ error: "internal", message: "Could not save the API key." }, 500);

  // Persist the active provider so quotes / time-series route to it.
  const { error: providerError } = await admin
    .from("app_secrets")
    .upsert({ key: "market_data_provider", value: providerId }, { onConflict: "key" });
  if (providerError) return json({ error: "internal", message: "Could not save the provider selection." }, 500);

  apiKeyCache = { provider: providerId, key: value, at: Date.now() };
  return json({ ok: true, configured: true, provider: providerId, provider_label: provider.label });
}

/** Admin: disconnect a market-data provider — remove its stored API key. */
async function handleDisconnect(providerId: string): Promise<Response> {
  const provider = PROVIDERS[providerId];
  if (!provider) return json({ error: "bad_request", message: "Unknown market data provider." }, 400);
  if (!admin) return json({ error: "internal", message: "Market data service is not configured." }, 500);

  // Remove the stored key for this provider so quotes/time-series stop routing
  // to it (resolveApiKey then falls back to the env secret / null).
  const { error: delErr } = await admin
    .from("app_secrets")
    .delete()
    .eq("key", `market_data_${providerId}`);
  if (delErr) {
    return json({ error: "internal", message: "Could not disconnect the provider." }, 500);
  }

  // If this was the active provider, clear the active marker too so the
  // platform doesn't keep routing quotes to a provider with no stored key.
  if ((await resolveSelectedProvider()) === providerId) {
    await admin.from("app_secrets").delete().eq("key", "market_data_provider");
  }

  apiKeyCache = null;
  return json({ ok: true, configured: false, provider: providerId, provider_label: provider.label });
}

// --- Helpers ----------------------------------------------------------------
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Like `num` but keeps null/empty as null so "missing" stays missing. */
function optNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isCryptoSymbol(symbol: string): boolean {
  return /BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC/.test(symbol);
}

/**
 * Is the market open for this symbol RIGHT NOW (UTC-based, deterministic)?
 * Crypto trades 24/7. Forex follows the standard retail session model:
 *   - Sunday 22:00 UTC  -> Friday 21:00 UTC
 *   - Daily break 21:00–22:00 UTC (Mon–Thu)
 *   - Closed all Saturday
 */
function isMarketOpen(symbol: string): boolean {
  if (isCryptoSymbol(symbol)) return true;
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  if (day === 0) return hour >= 22; // Sunday opens 22:00 UTC
  if (day >= 1 && day <= 4) return hour < 21 || hour >= 22; // Mon–Thu, daily break
  if (day === 5) return hour < 21; // Friday closes 21:00 UTC
  return false; // Saturday
}

// --- Auth -------------------------------------------------------------------
// Serves PUBLIC market data (the PRD allows anonymous visitors), so it accepts
// any valid credential for THIS project — the publishable key, the legacy
// anon/service_role key (identified by its `ref` claim), or a cryptographically
// verified user session JWT. Requests with nothing valid are rejected so the
// function can't be trivially abused to burn upstream credits.
const PROJECT_REF = (() => {
  try {
    const host = new URL(SUPABASE_URL).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : "";
  } catch {
    return "";
  }
})();

function isKnownPublishableKey(value: string): boolean {
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon && value === anon) return true;
  const pubsRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (pubsRaw) {
    try {
      const pubs = JSON.parse(pubsRaw) as Record<string, unknown>;
      for (const k of Object.values(pubs)) {
        if (typeof k === "string" && k === value) return true;
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return false;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Legacy anon/service_role JWT carries a `ref` claim identifying the project. */
function isProjectKeyJwt(token: string): boolean {
  if (!PROJECT_REF) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.ref !== "string") return false;
  return payload.ref === PROJECT_REF;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const apikey = req.headers.get("apikey");
  if (apikey && isKnownPublishableKey(apikey)) return true;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  // New publishable key mirrored into Authorization by supabase-js.
  if (isKnownPublishableKey(token)) return true;
  // Legacy anon key (no `sub`, so getUser rejects it — but it's a valid
  // project credential and exactly what unauthenticated clients send).
  if (isProjectKeyJwt(token)) return true;

  // User session JWT — cryptographically verified against GoTrue.
  try {
    const supabase = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

// --- Twelve Data ------------------------------------------------------------
function isRateLimited(res: Response, data: { status?: string; message?: string } | null): boolean {
  return (
    res.status === 429 ||
    (data?.status === "error" && /credit|rate|limit/i.test(data?.message ?? ""))
  );
}

interface QuoteResponse {
  status?: string;
  message?: string;
  symbol?: string;
  name?: string;
  datetime?: string;
  timestamp?: number;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
  previous_close?: string | number;
  change?: string | number;
  percent_change?: string | number;
  is_market_open?: boolean;
}

/**
 * Real-time quote via Twelve Data `/quote` (accurate live price, change,
 * percent change, open/high/low and market-open flag) — NOT a daily
 * `time_series` bar. This is what makes the dashboard/charts show the true
 * current price instead of yesterday's close.
 */
async function twelveDataQuote(apiKey: string, symbol: string): Promise<Quote> {
  const params = new URLSearchParams({ symbol, apikey: apiKey });
  const res = await fetch(`${TD_BASE}/quote?${params.toString()}`);
  const data = (await res.json().catch(() => null)) as QuoteResponse | null;

  const base: Quote = {
    symbol,
    price: null,
    change: null,
    percent_change: null,
    open: null,
    high: null,
    low: null,
    previous_close: null,
    is_market_open: isMarketOpen(symbol),
    datetime: null,
    error: null,
  };

  if (isRateLimited(res, data)) return { ...base, error: "rate_limited" };
  if (data?.status === "error") return { ...base, error: data.message ?? "upstream error" };

  const price = optNum(data?.close);
  if (price == null) return { ...base, error: "no data" };

  return {
    symbol,
    price,
    change: optNum(data?.change),
    percent_change: optNum(data?.percent_change),
    open: optNum(data?.open),
    high: optNum(data?.high),
    low: optNum(data?.low),
    previous_close: optNum(data?.previous_close),
    is_market_open: data?.is_market_open ?? isMarketOpen(symbol),
    datetime: data?.datetime ?? null,
  };
}

/** Twelve Data time-series (OHLC bars), ascending by time. */
async function twelveDataTimeSeries(
  apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  const params = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(outputsize),
    apikey: apiKey,
  });
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);

  const res = await fetch(`${TD_BASE}/time_series?${params.toString()}`);
  const data = (await res.json().catch(() => null)) as {
    status?: string;
    message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume: string }>;
  } | null;

  if (isRateLimited(res, data)) return { bars: [], error: "rate_limited", rateLimited: true };
  if (data?.status === "error") {
    return { bars: [], error: data.message ?? "Upstream error." };
  }

  const values = Array.isArray(data?.values) ? data.values : [];
  const bars: Bar[] = values.map((v) => ({
    time: v.datetime,
    open: num(v.open),
    high: num(v.high),
    low: num(v.low),
    close: num(v.close),
    volume: v.volume ? num(v.volume) : undefined,
  }));
  return { bars };
}

// --- Finnhub ----------------------------------------------------------------
/** Map our `AAA/BBB` watchlist symbol to a Finnhub symbol (OANDA forex / Binance crypto). */
function finnhubSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const [base, quote] = s.split("/");
  if (!base || !quote) return s;
  if (isCryptoSymbol(s)) {
    // Binance pairs are quoted in USDT on Finnhub (BTC/USD -> BINANCE:BTCUSDT).
    const q = quote === "USD" ? "USDT" : quote;
    return `BINANCE:${base}${q}`;
  }
  return `OAN:${base}${quote}`;
}

const FH_RESOLUTIONS: Record<string, string> = {
  "1min": "1",
  "5min": "5",
  "15min": "15",
  "30min": "30",
  "1h": "60",
  "4h": "60", // fetched as 1h then aggregated into 4h bars
  "1day": "D",
};

/** Combine `n` consecutive bars into one (used to build 4h bars from 1h). */
function aggregateBars(bars: Bar[], n: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i += n) {
    const chunk = bars.slice(i, i + n);
    if (chunk.length === 0) continue;
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((b) => b.high)),
      low: Math.min(...chunk.map((b) => b.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, b) => s + (b.volume ?? 0), 0),
    });
  }
  return out;
}

/** Finnhub real-time quote. */
async function finnhubQuote(apiKey: string, symbol: string): Promise<Quote> {
  const fhSym = finnhubSymbol(symbol);
  const base: Quote = {
    symbol,
    price: null,
    change: null,
    percent_change: null,
    open: null,
    high: null,
    low: null,
    previous_close: null,
    is_market_open: isMarketOpen(symbol),
    datetime: null,
    error: null,
  };

  try {
    const res = await fetch(`${FH_BASE}/quote?symbol=${encodeURIComponent(fhSym)}&token=${encodeURIComponent(apiKey)}`);
    const data = (await res.json().catch(() => null)) as {
      c?: number;
      h?: number;
      l?: number;
      o?: number;
      pc?: number;
      t?: number;
      error?: string;
    } | null;

    if (data?.error) return { ...base, error: data.error };
    const price = optNum(data?.c);
    if (price == null) return { ...base, error: "no data" };

    const prev = optNum(data?.pc);
    const change = prev != null ? price - prev : null;
    const percent = change != null && prev != null && prev !== 0 ? (change / prev) * 100 : null;

    return {
      symbol,
      price,
      change,
      percent_change: percent,
      open: optNum(data?.o),
      high: optNum(data?.h),
      low: optNum(data?.l),
      previous_close: prev,
      is_market_open: isMarketOpen(symbol),
      datetime: data?.t ? new Date(data.t * 1000).toISOString() : null,
    };
  } catch {
    return { ...base, error: "upstream error" };
  }
}

/** Finnhub candles (OHLC bars) — ascending by time; 4h is aggregated from 1h. */
async function finnhubTimeSeries(
  apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  const resolution = FH_RESOLUTIONS[interval] ?? "5";
  const fhSym = finnhubSymbol(symbol);
  const path = isCryptoSymbol(symbol) ? "crypto" : "forex";

  const to = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const barSecs = resolution === "D" ? 86_400 : Number(resolution) * 60;
  const from = startDate
    ? Math.floor(new Date(startDate).getTime() / 1000)
    : to - Math.max(outputsize * barSecs, 60);

  const url =
    `${FH_BASE}/${path}/candle?symbol=${encodeURIComponent(fhSym)}` +
    `&resolution=${resolution}&from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  const data = (await res.json().catch(() => null)) as {
    s?: string;
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    v?: number[];
    error?: string;
  } | null;

  if (data?.error) return { bars: [], error: data.error };
  if (data?.s !== "ok" || !Array.isArray(data.t) || data.t.length === 0) {
    return { bars: [], error: "no data" };
  }

  let bars: Bar[] = [];
  for (let i = 0; i < data.t.length; i++) {
    bars.push({
      time: new Date(data.t[i] * 1000).toISOString(),
      open: num(data.o?.[i]),
      high: num(data.h?.[i]),
      low: num(data.l?.[i]),
      close: num(data.c?.[i]),
      volume: data.v?.[i] != null ? num(data.v[i]) : undefined,
    });
  }

  if (interval === "4h") bars = aggregateBars(bars, 4);
  bars = bars.slice(-outputsize);
  return { bars };
}

// --- Alpha Vantage (keyed, free tier) --------------------------------------
/** Real-time FX/crypto rate via CURRENCY_EXCHANGE_RATE (uses no quote credit). */
async function alphaVantageQuote(apiKey: string, symbol: string): Promise<Quote> {
  const base: Quote = {
    symbol, price: null, change: null, percent_change: null, open: null, high: null, low: null,
    previous_close: null, is_market_open: isMarketOpen(symbol), datetime: null, error: null,
  };
  const [from, to] = symbol.split("/");
  if (!from || !to) return { ...base, error: "bad symbol" };
  try {
    const params = new URLSearchParams({
      function: "CURRENCY_EXCHANGE_RATE",
      from_currency: from,
      to_currency: to,
      apikey: apiKey,
    });
    const res = await fetch(`${AV_BASE}?${params.toString()}`);
    const data = (await res.json().catch(() => null)) as {
      "Realtime Currency Exchange Rate"?: Record<string, string>;
      "Error Message"?: string;
    } | null;
    if (data?.["Error Message"]) return { ...base, error: data["Error Message"] };
    const rate = data?.["Realtime Currency Exchange Rate"];
    const price = optNum(rate?.["5. Exchange Rate"]);
    if (price == null) return { ...base, error: "no data" };
    const bid = optNum(rate?.["8. Bid Price"]);
    const ask = optNum(rate?.["9. Ask Price"]);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : price;
    return { ...base, price: mid, previous_close: price, datetime: rate?.["6. Last Refreshed"] ?? null };
  } catch {
    return { ...base, error: "upstream error" };
  }
}

const AV_INTERVALS: Record<string, string> = {
  "1min": "1min", "5min": "5min", "15min": "15min", "30min": "30min", "1h": "60min", "4h": "60min",
};

/** Alpha Vantage time series — FX_INTRADAY/FX_DAILY for forex, CRYPTO_INTRADAY for crypto. */
async function alphaVantageTimeSeries(
  apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  const [from, to] = symbol.split("/");
  if (!from || !to) return { bars: [], error: "bad symbol" };
  const isCrypto = isCryptoSymbol(symbol);
  const params = new URLSearchParams({ apikey: apiKey });
  try {
    if (isCrypto) {
      params.set("function", "CRYPTO_INTRADAY");
      params.set("symbol", from);
      params.set("market", to);
      params.set("interval", AV_INTERVALS[interval] ?? "5min");
    } else if (interval === "1day") {
      params.set("function", "FX_DAILY");
      params.set("from_symbol", from);
      params.set("to_symbol", to);
    } else {
      params.set("function", "FX_INTRADAY");
      params.set("from_symbol", from);
      params.set("to_symbol", to);
      params.set("interval", AV_INTERVALS[interval] ?? "5min");
    }
    params.set("outputsize", String(Math.min(outputsize, 1000)));
    const res = await fetch(`${AV_BASE}?${params.toString()}`);
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (data?.["Error Message"]) return { bars: [], error: String(data["Error Message"]) };
    const seriesKey = Object.keys(data ?? {}).find((k) => k.startsWith("Time Series"));
    const series = seriesKey ? (data?.[seriesKey] as Record<string, Record<string, string>> | undefined) : undefined;
    if (!series) return { bars: [], error: "no data" };
    let bars: Bar[] = Object.entries(series).map(([time, v]) => ({
      time,
      open: num(v["1. open"] ?? v["1a. open (USD)"]),
      high: num(v["2. high"] ?? v["2a. high (USD)"]),
      low: num(v["3. low"] ?? v["3a. low (USD)"]),
      close: num(v["4. close"] ?? v["4a. close (USD)"]),
      volume: v["5. volume"] ? num(v["5. volume"]) : undefined,
    }));
    bars.sort((a, b) => a.time.localeCompare(b.time));
    if (interval === "4h") bars = aggregateBars(bars, 4);
    bars = bars.slice(-outputsize);
    return { bars };
  } catch {
    return { bars: [], error: "upstream error" };
  }
}

// --- Polygon.io (keyed, free tier) ------------------------------------------
/** Map `AAA/BBB` to a Polygon ticker: FX C:EURUSD, crypto X:BTCUSD. */
function polygonTicker(symbol: string): string {
  const [from, to] = symbol.split("/");
  if (!from || !to) return symbol;
  return isCryptoSymbol(symbol) ? `X:${from}${to}` : `C:${from}${to}`;
}

/** Polygon real-time quote (last trade) + previous close. */
async function polygonQuote(apiKey: string, symbol: string): Promise<Quote> {
  const base: Quote = {
    symbol, price: null, change: null, percent_change: null, open: null, high: null, low: null,
    previous_close: null, is_market_open: isMarketOpen(symbol), datetime: null, error: null,
  };
  const ticker = polygonTicker(symbol);
  try {
    const [lastRes, prevRes] = await Promise.all([
      fetch(`${POLY_BASE}/v2/last/trade/${ticker}?apiKey=${encodeURIComponent(apiKey)}`),
      fetch(`${POLY_BASE}/v2/aggs/ticker/${ticker}/prev?apiKey=${encodeURIComponent(apiKey)}`),
    ]);
    const lastData = (await lastRes.json().catch(() => null)) as { results?: { price?: number; timestamp?: number } };
    const prevData = (await prevRes.json().catch(() => null)) as { results?: Array<{ c?: number }> };
    const price = optNum(lastData?.results?.price);
    if (price == null) return { ...base, error: "no data" };
    const prev = optNum(prevData?.results?.[0]?.c);
    const change = prev != null ? price - prev : null;
    return {
      ...base,
      price,
      change,
      percent_change: change != null && prev != null && prev !== 0 ? (change / prev) * 100 : null,
      previous_close: prev,
      datetime: lastData?.results?.timestamp ? new Date(lastData.results.timestamp).toISOString() : null,
    };
  } catch {
    return { ...base, error: "upstream error" };
  }
}

const POLY_TIMESPAN: Record<string, { mult: number; span: string }> = {
  "1min": { mult: 1, span: "minute" },
  "5min": { mult: 5, span: "minute" },
  "15min": { mult: 15, span: "minute" },
  "30min": { mult: 30, span: "minute" },
  "1h": { mult: 1, span: "hour" },
  "4h": { mult: 4, span: "hour" },
  "1day": { mult: 1, span: "day" },
};

/** Polygon aggregated bars — ascending by time; 4h via 4/hour. */
async function polygonTimeSeries(
  apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  const ticker = polygonTicker(symbol);
  const { mult, span } = POLY_TIMESPAN[interval] ?? { mult: 5, span: "minute" };
  const spanMs = span === "day" ? 86_400_000 : span === "hour" ? 3_600_000 : 60_000;
  const to = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const from = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : to - Math.max(outputsize * mult * (spanMs / 1000), 60);
  try {
    const url =
      `${POLY_BASE}/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=${Math.min(outputsize, 5000)}&apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = (await res.json().catch(() => null)) as { results?: Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }> };
    const rows = data?.results ?? [];
    if (rows.length === 0) return { bars: [], error: "no data" };
    let bars: Bar[] = rows.map((r) => ({
      time: new Date(r.t).toISOString(),
      open: num(r.o),
      high: num(r.h),
      low: num(r.l),
      close: num(r.c),
      volume: r.v != null ? num(r.v) : undefined,
    }));
    if (interval === "4h") bars = aggregateBars(bars, 4);
    bars = bars.slice(-outputsize);
    return { bars };
  } catch {
    return { bars: [], error: "upstream error" };
  }
}

// --- Yahoo Finance (keyless, free fallback) ----------------------------------
/** Map `AAA/BBB` to a Yahoo symbol: FX EURUSD=X, crypto BTC-USD. */
function yahooSymbol(symbol: string): string {
  const [from, to] = symbol.split("/");
  if (!from || !to) return symbol;
  return isCryptoSymbol(symbol) ? `${from}-${to}` : `${from}${to}=X`;
}

async function yahooQuote(_apiKey: string, symbol: string): Promise<Quote> {
  const base: Quote = {
    symbol, price: null, change: null, percent_change: null, open: null, high: null, low: null,
    previous_close: null, is_market_open: isMarketOpen(symbol), datetime: null, error: null,
  };
  try {
    const sym = yahooSymbol(symbol);
    const res = await fetch(`${YH_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FXToolkit/1.0)" },
    });
    const data = (await res.json().catch(() => null)) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number; regularMarketDayHigh?: number; regularMarketDayLow?: number; regularMarketOpen?: number; regularMarketTime?: number } }> };
    };
    const meta = data?.chart?.result?.[0]?.meta;
    const price = optNum(meta?.regularMarketPrice);
    if (price == null) return { ...base, error: "no data" };
    const prev = optNum(meta?.chartPreviousClose);
    const change = prev != null ? price - prev : null;
    return {
      ...base,
      price,
      change,
      percent_change: change != null && prev != null && prev !== 0 ? (change / prev) * 100 : null,
      open: optNum(meta?.regularMarketOpen),
      high: optNum(meta?.regularMarketDayHigh),
      low: optNum(meta?.regularMarketDayLow),
      previous_close: prev,
      datetime: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    };
  } catch {
    return { ...base, error: "upstream error" };
  }
}

const YH_INTERVALS: Record<string, string> = {
  "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m", "1h": "60m", "4h": "60m", "1day": "1d",
};
const YH_RANGES: Record<string, string> = {
  "1min": "1d", "5min": "5d", "15min": "5d", "30min": "1mo", "1h": "1mo", "4h": "3mo", "1day": "1y",
};

async function yahooTimeSeries(
  _apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  const sym = yahooSymbol(symbol);
  const iv = YH_INTERVALS[interval] ?? "5m";
  const range = YH_RANGES[interval] ?? "5d";
  try {
    const res = await fetch(`${YH_BASE}/${encodeURIComponent(sym)}?interval=${iv}&range=${range}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FXToolkit/1.0)" },
    });
    const data = (await res.json().catch(() => null)) as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> } }> };
    };
    const result = data?.chart?.result?.[0];
    const q = result?.indicators?.quote?.[0];
    const ts = result?.timestamp ?? [];
    if (!ts.length || !q) return { bars: [], error: "no data" };
    let bars: Bar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({
        time: new Date(ts[i] * 1000).toISOString(),
        open: o, high: h, low: l, close: c,
        volume: q.volume?.[i] != null ? q.volume[i] : undefined,
      });
    }
    if (interval === "4h") bars = aggregateBars(bars, 4);
    bars = bars.slice(-outputsize);
    return { bars };
  } catch {
    return { bars: [], error: "upstream error" };
  }
}

// --- Free keyless source (Binance public API for crypto + Yahoo for FX) ------
/** Map `AAA/BBB` to a Binance spot symbol (crypto pairs on Binance are quoted in USDT). */
function binanceSymbol(symbol: string): string {
  const [from, to] = symbol.split("/");
  if (!from) return symbol;
  const quote = to && to.trim().toUpperCase() !== "USD" ? to.trim().toUpperCase() : "USDT";
  return `${from.toUpperCase()}${quote}`;
}

const BN_INTERVALS: Record<string, string> = {
  "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m", "1h": "1h", "4h": "4h", "1day": "1d",
};

/** Crypto quote via Binance 24hr ticker (public endpoint, no key, one call per symbol). */
async function binanceQuote(_apiKey: string, symbol: string): Promise<Quote> {
  const base: Quote = {
    symbol, price: null, change: null, percent_change: null, open: null, high: null, low: null,
    previous_close: null, is_market_open: isMarketOpen(symbol), datetime: null, error: null,
  };
  try {
    const res = await fetch(`${BN_BASE}/ticker/24hr?symbol=${encodeURIComponent(binanceSymbol(symbol))}`);
    if (res.status === 429 || res.status === 418) return { ...base, error: "rate_limited" };
    const data = (await res.json().catch(() => null)) as {
      lastPrice?: string;
      openPrice?: string;
      highPrice?: string;
      lowPrice?: string;
      prevClosePrice?: string;
      priceChange?: string;
      priceChangePercent?: string;
      closeTime?: number;
      code?: number;
    } | null;
    if (data?.code || typeof data?.lastPrice !== "string") return { ...base, error: "no data" };
    const price = num(data.lastPrice);
    if (price <= 0) return { ...base, error: "no data" };
    return {
      symbol,
      price,
      change: optNum(data.priceChange),
      percent_change: optNum(data.priceChangePercent),
      open: optNum(data.openPrice),
      high: optNum(data.highPrice),
      low: optNum(data.lowPrice),
      previous_close: optNum(data.prevClosePrice),
      is_market_open: true,
      datetime: data.closeTime ? new Date(data.closeTime).toISOString() : null,
    };
  } catch {
    return { ...base, error: "upstream error" };
  }
}

/**
 * Real-time crypto quotes in a single batched call. The public Binance `ticker`
 * (rolling 24h) endpoint accepts a `symbols` array (up to 100) and returns
 * last/high/low/open/change for all of them — one cheap upstream call
 * (weight ~4/symbol) keeps the whole crypto watchlist live at a sub-10s cadence
 * with no API key and no credit cost. Symbols Binance doesn't list simply
 * aren't returned; the caller falls back to Yahoo for those.
 */
async function binanceBatchQuote(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const unique = [...new Set(symbols)];
  if (unique.length === 0) return out;
  const reverse = new Map<string, string>();
  for (const s of unique) reverse.set(binanceSymbol(s), s);
  const batch = [...reverse.keys()].slice(0, 100);
  try {
    const res = await fetch(`${BN_BASE}/ticker?symbols=${encodeURIComponent(JSON.stringify(batch))}`);
    if (res.status === 429 || res.status === 418) return out;
    const data = (await res.json().catch(() => null)) as
      | Array<{
          symbol?: string;
          lastPrice?: string;
          openPrice?: string;
          highPrice?: string;
          lowPrice?: string;
          prevClosePrice?: string;
          priceChange?: string;
          priceChangePercent?: string;
          closeTime?: number;
        }>
      | { code?: number; msg?: string }
      | null;
    if (!Array.isArray(data)) return out;
    for (const d of data) {
      const orig = d.symbol ? reverse.get(d.symbol) : undefined;
      if (!orig) continue;
      const price = num(d.lastPrice ?? "");
      if (price <= 0) continue;
      out.set(orig, {
        symbol: orig,
        price,
        change: optNum(d.priceChange),
        percent_change: optNum(d.priceChangePercent),
        open: optNum(d.openPrice),
        high: optNum(d.highPrice),
        low: optNum(d.lowPrice),
        previous_close: optNum(d.prevClosePrice),
        is_market_open: true,
        datetime: d.closeTime ? new Date(d.closeTime).toISOString() : null,
      });
    }
  } catch {
    // Non-fatal — caller falls back per-symbol to Yahoo.
  }
  return out;
}

/** Crypto OHLC klines from Binance — ascending by time; natively supports 4h/1d. */
async function binanceTimeSeries(
  _apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  const params = new URLSearchParams({ symbol: binanceSymbol(symbol), interval: BN_INTERVALS[interval] ?? "5m" });
  if (startDate) params.set("startTime", String(new Date(startDate).getTime()));
  if (endDate) params.set("endTime", String(new Date(endDate).getTime()));
  params.set("limit", String(Math.min(outputsize, 1000)));
  try {
    const res = await fetch(`${BN_BASE}/klines?${params.toString()}`);
    if (res.status === 429 || res.status === 418) return { bars: [], error: "rate_limited", rateLimited: true };
    const data = (await res.json().catch(() => null)) as unknown[] | { code?: number } | null;
    if (!Array.isArray(data) || data.length === 0) return { bars: [], error: "no data" };
    const bars: Bar[] = (data as Array<Array<number | string>>).map((k) => ({
      time: new Date(Number(k[0])).toISOString(),
      open: num(k[1]),
      high: num(k[2]),
      low: num(k[3]),
      close: num(k[4]),
      volume: k[5] != null ? num(k[5]) : undefined,
    }));
    return { bars };
  } catch {
    return { bars: [], error: "upstream error" };
  }
}

/**
 * Hybrid free source: crypto → Binance public API with an automatic per-symbol
 * fallback to Yahoo; FX → Yahoo. Keeps the free tier working even if one of the
 * free upstreams is unreachable or geo-blocked from the function's region.
 */
async function freeQuote(_apiKey: string, symbol: string): Promise<Quote> {
  if (isCryptoSymbol(symbol)) {
    const bin = await binanceQuote("", symbol);
    if (!bin.error && bin.price != null) return bin;
  }
  return yahooQuote("", symbol);
}

async function freeTimeSeries(
  _apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  if (isCryptoSymbol(symbol)) {
    const bin = await binanceTimeSeries("", symbol, interval, outputsize, startDate, endDate);
    if (!bin.error && bin.bars.length > 0) return bin;
  }
  return yahooTimeSeries("", symbol, interval, outputsize, startDate, endDate);
}

// --- OANDA (broker-derived market data, auto-generated) ----------------------
/** Reads the broker-derived OANDA source (account + env stored when generated). */
async function oandaSource(): Promise<{ base: string; account: string } | null> {
  if (!admin) return null;
  const { data } = await admin
    .from("app_secrets")
    .select("key,value")
    .in("key", ["market_data_oanda_account", "market_data_oanda_env"]);
  const map = new Map<string, string>((data ?? []).map((r) => [String(r.key), String(r.value ?? "")]));
  const account = map.get("market_data_oanda_account") ?? "";
  const env = map.get("market_data_oanda_env") ?? "practice";
  if (!account) return null;
  return { base: env === "live" ? OANDA_LIVE : OANDA_PRACTICE, account };
}

function oandaInstrument(symbol: string): string {
  return symbol.trim().toUpperCase().replace("/", "_");
}

/** OANDA real-time mid price via the pricing endpoint. */
async function oandaQuote(apiKey: string, symbol: string): Promise<Quote> {
  const base: Quote = {
    symbol, price: null, change: null, percent_change: null, open: null, high: null, low: null,
    previous_close: null, is_market_open: isMarketOpen(symbol), datetime: null, error: null,
  };
  const src = await oandaSource();
  if (!src) return { ...base, error: "broker source not configured" };
  const inst = oandaInstrument(symbol);
  try {
    const res = await fetch(
      `${src.base}/v3/accounts/${src.account}/pricing?instruments=${encodeURIComponent(inst)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const data = (await res.json().catch(() => null)) as {
      prices?: Array<{ bids?: Array<{ price: string }>; asks?: Array<{ price: string }>; time?: string }>;
    };
    const p = data?.prices?.[0];
    const bid = optNum(p?.bids?.[0]?.price);
    const ask = optNum(p?.asks?.[0]?.price);
    if (bid == null || ask == null) return { ...base, error: "no data" };
    return { ...base, price: (bid + ask) / 2, datetime: p?.time ?? null };
  } catch {
    return { ...base, error: "upstream error" };
  }
}

const OANDA_GRANULARITY: Record<string, string> = {
  "1min": "M1", "5min": "M5", "15min": "M15", "30min": "M30", "1h": "H1", "4h": "H4", "1day": "D",
};

/** OANDA candles (mid prices) — ascending by time. */
async function oandaTimeSeries(
  apiKey: string,
  symbol: string,
  interval: string,
  outputsize: number,
  startDate?: string,
  endDate?: string,
): Promise<{ bars: Bar[]; error?: string; rateLimited?: boolean }> {
  const src = await oandaSource();
  if (!src) return { bars: [], error: "broker source not configured" };
  const inst = oandaInstrument(symbol);
  const granularity = OANDA_GRANULARITY[interval] ?? "M5";
  try {
    const res = await fetch(
      `${src.base}/v3/instruments/${encodeURIComponent(inst)}/candles?granularity=${granularity}&count=${Math.min(outputsize, 5000)}&price=M`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const data = (await res.json().catch(() => null)) as {
      candles?: Array<{ time?: string; mid?: { o?: string; h?: string; l?: string; c?: string }; volume?: number }>;
    };
    const candles = data?.candles ?? [];
    if (candles.length === 0) return { bars: [], error: "no data" };
    let bars: Bar[] = candles
      .filter((c) => c.mid?.o != null)
      .map((c) => ({
        time: c.time ?? "",
        open: num(c.mid?.o),
        high: num(c.mid?.h),
        low: num(c.mid?.l),
        close: num(c.mid?.c),
        volume: c.volume != null ? num(c.volume) : undefined,
      }));
    bars = bars.slice(-outputsize);
    return { bars };
  } catch {
    return { bars: [], error: "upstream error" };
  }
}

// --- Provider registry ------------------------------------------------------
const PROVIDERS: Record<string, MarketProvider> = {
  twelvedata: {
    id: "twelvedata",
    label: "Twelve Data",
    signupUrl: "https://twelvedata.com",
    envKey: "TWELVE_DATA_API_KEY",
    validate: async (apiKey) => {
      // Validate against Twelve Data's account-usage endpoint (doesn't spend a
      // quote credit). On network failure we still save.
      try {
        const res = await fetch(`${TD_BASE}/api_usage?apikey=${encodeURIComponent(apiKey)}`);
        const data = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
        if (!res.ok || data?.status === "error") {
          return data?.message ?? "Twelve Data rejected this key.";
        }
      } catch {
        // ignore — keep saving
      }
      return null;
    },
    fetchQuote: twelveDataQuote,
    fetchTimeSeries: twelveDataTimeSeries,
  },
  finnhub: {
    id: "finnhub",
    label: "Finnhub",
    signupUrl: "https://finnhub.io",
    envKey: "FINNHUB_API_KEY",
    validate: async (apiKey) => {
      // Probe a known OANDA forex symbol; a rejected token returns an error.
      try {
        const res = await fetch(`${FH_BASE}/quote?symbol=OAN:EURUSD&token=${encodeURIComponent(apiKey)}`);
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok || data?.error) {
          return data?.error ?? "Finnhub rejected this key.";
        }
      } catch {
        // ignore — keep saving
      }
      return null;
    },
    fetchQuote: finnhubQuote,
    fetchTimeSeries: finnhubTimeSeries,
  },
  alphavantage: {
    id: "alphavantage",
    label: "Alpha Vantage",
    signupUrl: "https://www.alphavantage.co",
    envKey: "ALPHA_VANTAGE_API_KEY",
    source: "keyed",
    validate: async (apiKey) => {
      try {
        const res = await fetch(
          `${AV_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=EUR&to_currency=USD&apikey=${encodeURIComponent(apiKey)}`,
        );
        const data = (await res.json().catch(() => null)) as { "Error Message"?: string } | null;
        if (data?.["Error Message"]) return "Alpha Vantage rejected this key.";
      } catch {
        // ignore — keep saving
      }
      return null;
    },
    fetchQuote: alphaVantageQuote,
    fetchTimeSeries: alphaVantageTimeSeries,
  },
  polygon: {
    id: "polygon",
    label: "Polygon.io",
    signupUrl: "https://polygon.io",
    envKey: "POLYGON_API_KEY",
    source: "keyed",
    validate: async (apiKey) => {
      try {
        const res = await fetch(`${POLY_BASE}/v2/aggs/ticker/X:BTCUSD/prev?apiKey=${encodeURIComponent(apiKey)}`);
        const data = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
        if (res.status === 401 || res.status === 403 || data?.status === "ERROR") return "Polygon.io rejected this key.";
      } catch {
        // ignore — keep saving
      }
      return null;
    },
    fetchQuote: polygonQuote,
    fetchTimeSeries: polygonTimeSeries,
  },
  yahoo: {
    id: "yahoo",
    label: "Free market data",
    signupUrl: "https://www.binance.com",
    envKey: "",
    keyless: true,
    source: "keyless",
    validate: async () => null,
    fetchQuote: freeQuote,
    fetchTimeSeries: freeTimeSeries,
  },
  oanda: {
    id: "oanda",
    label: "OANDA (broker trader account)",
    signupUrl: "https://www.oanda.com",
    envKey: "OANDA_API_KEY",
    source: "broker",
    validate: async () => "OANDA market data is generated from your broker trader account on the Brokers page — not a pasted key.",
    fetchQuote: oandaQuote,
    fetchTimeSeries: oandaTimeSeries,
  },
};

/**
 * Push fresh quotes to every connected client over Supabase Realtime so charts
 * and robots update live instead of waiting for their next poll. Best-effort:
 * if broadcasting fails, clients simply fall back to their poll interval.
 */
async function broadcastQuotes(quotes: Quote[], anyStale: boolean): Promise<void> {
  if (!SUPABASE_URL || !ADMIN_KEY || !Array.isArray(quotes) || quotes.length === 0) return;
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ADMIN_KEY },
      body: JSON.stringify({
        messages: [
          {
            topic: "market-quotes",
            event: "quotes",
            payload: { quotes, anyStale, at: Date.now() },
          },
        ],
      }),
    });
  } catch {
    // Non-fatal — clients fall back to polling.
  }
}

async function handleQuotes(providerId: string, apiKey: string, priority: string[] = []): Promise<Response> {
  const provider = PROVIDERS[providerId];
  const cacheKeys = WATCHLIST.map((s) => `quote:${providerId}:${s}`);
  const cache = await cacheGetMany(cacheKeys);

  const now = Date.now();
  const keyless = !!provider.keyless;
  // Free source quotes go stale after a few seconds so the watchlist fluctuates
  // in real time; keyed providers stay fresh for 5 minutes to protect credits.
  const freshMs = keyless ? QUOTES_FRESH_FREE_MS : QUOTES_FRESH_MS;
  const quotes: Quote[] = [];
  let served = 0;
  let anyStale = false;

  // 1) Build the list from cache, tracking age so we know what to refresh.
  const toRefresh: { symbol: string; age: number }[] = [];
  for (const symbol of WATCHLIST) {
    const row = cache.get(`quote:${providerId}:${symbol}`);
    const payload = (row?.payload ?? memoryCache.get(`quote:${providerId}:${symbol}`)?.value) as Quote | undefined;
    const updatedAt = row ? new Date(row.updated_at).getTime() : memoryCache.get(`quote:${providerId}:${symbol}`)?.at ?? 0;

    if (payload && payload.symbol) {
      const age = now - updatedAt;
      const fresh = age <= freshMs;
      quotes.push({ ...payload, stale: fresh ? payload.stale : true });
      if (!fresh) anyStale = true;
      served++;
      if (!fresh) toRefresh.push({ symbol, age });
    } else {
      toRefresh.push({ symbol, age: Number.MAX_SAFE_INTEGER });
      quotes.push({
        symbol,
        price: null,
        change: null,
        percent_change: null,
        open: null,
        high: null,
        low: null,
        previous_close: null,
        is_market_open: isMarketOpen(symbol),
        datetime: null,
        stale: true,
        error: "no data yet",
      });
    }
  }

  // 2) Refresh stale symbols. Priority symbols (the ones the caller is actively
  //    trading / viewing) always go first.
  const prioritySet = new Set(priority.map((s) => s.toUpperCase()));
  toRefresh.sort((a, b) => {
    const ap = prioritySet.has(a.symbol) ? 0 : 1;
    const bp = prioritySet.has(b.symbol) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return b.age - a.age;
  });
  let refreshed = 0;
  let upstreamBlocked = false;

  const applyQuote = async (symbol: string, q: Quote) => {
    if (q.error) return false;
    await cacheSet(`quote:${providerId}:${symbol}`, { ...q, stale: false });
    const idx = quotes.findIndex((x) => x.symbol === symbol);
    if (idx >= 0) quotes[idx] = { ...q, stale: false };
    return true;
  };

  if (keyless) {
    // Free source — real-time cadence. All stale crypto refresh in ONE batched
    // Binance call (sub-10s updates, no key, no credit cost); stale FX rotates
    // through Yahoo on a light per-instance throttle.
    const cryptoStale = toRefresh.filter(({ symbol }) => isCryptoSymbol(symbol));
    const fxStale = toRefresh.filter(({ symbol }) => !isCryptoSymbol(symbol));

    if (cryptoStale.length > 0 && canUseFreeBatch()) {
      const batch = await binanceBatchQuote(cryptoStale.map((x) => x.symbol));
      if (batch.size > 0) {
        for (const [symbol, q] of batch) {
          if (await applyQuote(symbol, q)) refreshed++;
        }
        anyStale = false; // crypto is live again
      }
      // Symbols Binance didn't return (or a failed batch) → one-off Yahoo fallback.
      const missing = cryptoStale.filter(({ symbol }) => !batch.has(symbol));
      for (const { symbol } of missing) {
        if (!canUseCredit()) break;
        const q = await yahooQuote("", symbol);
        if (await applyQuote(symbol, q)) refreshed++;
      }
    }

    let fxRefreshed = 0;
    for (const { symbol } of fxStale) {
      if (fxRefreshed >= FREE_FX_BUDGET) break;
      if (!canUseCredit()) break;
      try {
        const q = await provider.fetchQuote("", symbol);
        if (await applyQuote(symbol, q)) {
          refreshed++;
          fxRefreshed++;
        }
      } catch {
        // keep whatever we had
      }
    }
  } else {
    // Keyed providers — conservative: a small per-request budget behind the
    // shared 8/min gate so the provider's credit allowance isn't burned.
    const budget = toRefresh.slice(0, QUOTES_REFRESH_BUDGET);
    for (const { symbol } of budget) {
      if (!canUseCredit() || !(await claimUpstreamSlot())) {
        upstreamBlocked = true;
        break;
      }
      try {
        const q = await provider.fetchQuote(apiKey, symbol);
        if (!q.error) {
          await applyQuote(symbol, q);
          anyStale = false; // at least one symbol got fresh data
          refreshed++;
        } else if (q.error === "rate_limited") {
          upstreamBlocked = true;
          break;
        } else {
          // Upstream error for this symbol — keep whatever we had.
          const idx = quotes.findIndex((x) => x.symbol === symbol);
          if (idx >= 0) quotes[idx] = { ...quotes[idx], error: q.error };
        }
      } catch {
        upstreamBlocked = true;
        break;
      }
    }
  }

  if (refreshed === 0 && served === 0 && upstreamBlocked) {
    return json({ error: "rate_limited" });
  }
  if (refreshed === 0 && served === 0) {
    return json({ error: "upstream", message: "Market data is unavailable right now." });
  }

  // Push the refreshed quotes to every connected client via Realtime broadcast.
  if (refreshed > 0) await broadcastQuotes(quotes, anyStale);

  return json({ quotes, anyStale });
}

async function handleTimeSeries(providerId: string, apiKey: string, body: Record<string, unknown>): Promise<Response> {
  const provider = PROVIDERS[providerId];
  const symbol = String(body.symbol ?? "").toUpperCase();
  const interval = VALID_INTERVALS.includes(String(body.interval)) ? String(body.interval) : "1day";
  const outputsize = Math.min(Math.max(Number(body.outputsize) || 500, 1), MAX_OUTPUTSIZE);
  const start_date = body.start_date ? String(body.start_date) : undefined;
  const end_date = body.end_date ? String(body.end_date) : undefined;

  if (!symbol) return json({ error: "bad_request", message: "Missing symbol." }, 400);

  const cacheKey = `ts:${providerId}:${symbol}:${interval}:${outputsize}:${start_date ?? ""}:${end_date ?? ""}`;
  const ttl = TTL_MS[interval] ?? 5 * 60_000;

  const now = Date.now();
  const row = (await cacheGetMany([cacheKey])).get(cacheKey);
  const mem = memoryCache.get(cacheKey);
  const payload = (row?.payload ?? mem?.value) as Bar[] | undefined;
  const updatedAt = row ? new Date(row.updated_at).getTime() : (mem?.at ?? 0);

  if (payload && Array.isArray(payload) && now - updatedAt <= ttl) {
    return json({ bars: payload });
  }

  // To call upstream we must hold BOTH the per-instance bucket and the shared
  // gate. This applies to cold fetches too (no cached payload), otherwise the
  // robot's first bar fetch could fire every symbol at once and 429 the key.
  if (!canUseCredit() || !(await claimUpstreamSlot())) {
    if (payload && Array.isArray(payload)) return json({ bars: payload, stale: true });
    return json({ error: "rate_limited" });
  }

  const res = await provider.fetchTimeSeries(apiKey, symbol, interval, outputsize, start_date, end_date);

  if (res.rateLimited) {
    if (payload && Array.isArray(payload)) return json({ bars: payload, stale: true });
    return json({ error: "rate_limited" });
  }
  if (res.error) {
    if (payload && Array.isArray(payload)) return json({ bars: payload, stale: true });
    return json({ error: "upstream", message: res.error ?? "Upstream error." });
  }

  await cacheSet(cacheKey, res.bars);
  return json({ bars: res.bars });
}

// --- Handler -----------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // CORS preflight — required so the browser can call us cross-origin.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authorized = await isAuthorized(req);
    if (!authorized) return json({ error: "unauthorized" }, 401);

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "bad_request", message: "Invalid JSON body." }, 400);
    }

    // Provider status is a safe read for any valid credential (no keys are
    // ever returned). Signing in is enough to flip the platform to the built-in
    // free source — this is how non-admin users bootstrap market data from the
    // Configuration page.
    if (body.action === "market_config") return await handleMarketConfig();
    if (body.action === "activate_free") {
      if (!(await hasSession(req))) return json({ error: "unauthorized" }, 401);
      return await handleActivateFree();
    }

    // Admin-only actions: change a provider key, disconnect a provider, or
    // generate the market data source from the caller's broker trader account.
    // These run before the key-exists check so a key can be configured (or
    // removed) even when none is set yet.
    if (body.action === "set_api_key" || body.action === "disconnect" || body.action === "set_broker_source") {
      if (!(await isAdmin(req))) return json({ error: "unauthorized" }, 401);
      if (body.action === "disconnect") return await handleDisconnect(String(body.provider ?? "twelvedata"));
      if (body.action === "set_broker_source") return await handleSetBrokerSource(req);
      return await handleSetApiKey(body);
    }

    // Automatic fallback: the chain is [selected, ...other keyed, ...keyless].
    // If the active provider fails (expired key, rate limit, upstream error) the
    // next usable provider serves the request and becomes the active one.
    const chain = await resolveProviderChain();
    if (chain.length === 0) return json({ error: "no_api_key" });

    if (body.action === "quotes") {
      const priority = Array.isArray(body.priority) ? body.priority.map(String) : [];
      return await handleQuotesWithFallback(chain, priority);
    }
    if (body.action === "time_series") return await handleTimeSeriesWithFallback(chain, body);
    return json({ error: "unknown_action", message: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    console.error("market-data error", err);
    return json({ error: "internal", message: "Market data is unavailable right now." }, 500);
  }
});