/**
 * broker-mt — cloud bridge to the user's MetaTrader 4/5 account via MetaApi.
 *
 * MT4/MT5 are desktop terminals with no public REST API, so a serverless
 * function cannot dial into an account with login/password/server directly.
 * This function proxies every request through MetaApi's cloud gateway
 * (https://metaapi.cloud) — the MetaApi API token is resolved per connection:
 *
 *   1. the user's OWN free MetaApi token (saved from the Brokers page,
 *      encrypted at rest on broker_connections.metaapi_token), or
 *   2. the platform-wide `METAAPI_TOKEN` Edge Function secret (general token).
 *
 * Which one is used is an ADMIN SETTING, `settings.metaapi_token_mode`:
 *   - 'user'    (default) — the user's own token first, then the general
 *                           token as fallback;
 *   - 'general'            — ONLY the general `METAAPI_TOKEN` secret; per-user
 *                           tokens are ignored (never decrypted/used).
 * Admins switch the mode, read the bridge config, and set/clear the general
 * token through the admin-only actions `metaapi-mode-set` / `metaapi-config` /
 * `metaapi-token-set` / `metaapi-token-clear`. The general token is stored in
 * the app's secure token store (`app_secrets` — RLS deny-all, service-role
 * only) using the caller's signed-in admin session as the credential; no
 * Personal Access Token is required. When a PAT (SUPABASE_ACCESS_TOKEN) is
 * configured, the token is ALSO mirrored to the project's Edge Function
 * secrets via the Supabase Management API so env-var readers keep working
 * (best-effort, never blocking). The raw token never reaches the browser.
 *
 * The MT account credentials (login / password / server) come from the user's
 * saved `broker_connections` row (platform = 'mt4' | 'mt5'), so neither the
 * password nor any token ever reaches the browser.
 *
 * The "add your MetaApi token" flow runs a SECURITY PASS before activation:
 * the token is validated live against MetaApi's provisioning API
 * (`GET /users/current`) and the connected MT account is looked up under that
 * token. Only after the pass does `metaapi-activate` provision (auto-generate)
 * + deploy the account — "auto-generate & inject from the free provider".
 *
 * Actions (`action`, passed in the JSON body):
 *   verify          -> validate the resolved token and report whether the saved
 *                      MT account is provisioned + deployed in MetaApi.
 *   provision       -> create the MT account in MetaApi and deploy it
 *                      (optional body: provisioningProfileId).
 *   metaapi-status  -> per-connection MetaApi state (masked token, security
 *                      pass result, activation state) without any MetaApi call.
 *   metaapi-save    -> store the user's own MetaApi token (encrypted at rest),
 *                      validate it live and run the security pass.
 *   metaapi-check   -> re-run the security pass with the resolved token.
 *   metaapi-activate-> security-pass gate, then provision + deploy the account
 *                      and mark the connection live-trading active.
 *   metaapi-remove  -> clear the user's saved MetaApi token + activation state.
 *   metaapi-config    -> ADMIN ONLY: read the token mode + whether the general
 *                        METAAPI_TOKEN secret is set (masked only).
 *   metaapi-mode-set  -> ADMIN ONLY: switch between per-user tokens and the
 *                        general platform token.
 *   metaapi-token-set -> ADMIN ONLY: replace the general METAAPI_TOKEN secret
 *                        (via the Management API) and validate it live.
 *   metaapi-token-clear-> ADMIN ONLY: remove the general METAAPI_TOKEN secret.
 *   state           -> deployment + connection status of the MetaApi account.
 *   summary         -> account-information (balance, equity, currency).
 *   open-trades     -> open positions (the robot's live positions).
 *   closed-trades   -> recently filled history orders (the live journal).
 *   open-position   -> market order with SL/TP (needs symbol/side/units).
 *   close-position  -> close one open position by MetaApi position id.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveTokenWithFallback } from "./tokenFallback.ts";
import type { MetaTokenSource } from "./tokenFallback.ts";

/**
 * MetaApi serves its REST API from two separate hosts:
 *  - PROVISIONING (mt-provisioning-api-v1…): account lifecycle — list accounts,
 *    create account, deploy/undeploy. This is the host the SDK's account API
 *    (`/users/current/accounts`, `/deploy`) is served from.
 *  - CLIENT (mt-client-api-v1…): trading data + operations — account
 *    information, positions, trade history, placing/closing orders.
 * They can have different TLS states, so each action must target the host that
 * actually serves it (the provisioning host is the one that makes "connect +
 * auto-provision an MT4/5 account" work).
 */
const METAAPI_PROVISIONING_BASE = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const METAAPI_BASE = "https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai";
/** 1 standard lot = 100,000 base units (the engine's "units" semantics). */
const UNITS_PER_LOT = 100_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * fetch with a hard timeout. MetaApi has been observed to hang (TLS
 * negotiation, deployment races), and an Edge Function that never answers
 * makes the browser client abort and show a generic "could not load your
 * account" message with no real reason. Every MetaApi call goes through here
 * so the function always returns a specific, actionable error promptly.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`MetaApi did not respond within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** App symbol "EUR/USD" -> MetaTrader symbol "EURUSD" (no slash, uppercase). */
function mtSymbol(symbol: string): string {
  return symbol.replace("/", "").toUpperCase();
}

/** MetaTrader symbol "EURUSD" -> app symbol "EUR/USD" (best-effort split). */
function appSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.length === 6) return `${s.slice(0, 3)}/${s.slice(3)}`;
  return s;
}

/** MetaApi unix-ms epoch -> ISO string (or empty). */
function iso(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : "";
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Hard server-side cap on any single order, in standard lots. */
const MAX_LOTS_PER_ORDER = 100;

/** Read the platform's risk defaults from the DB — the client cannot override. */
async function loadRiskLimits(supabase: any) {
  const { data } = await supabase.from("settings").select("value").eq("key", "risk_defaults").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, number>;
  return {
    maxOpenPositions: Number(v.maxOpenPositions) > 0 ? Number(v.maxOpenPositions) : 5,
    maxDailyLossPct: Number(v.maxDailyLossPct) > 0 ? Number(v.maxDailyLossPct) : 5,
  };
}

/** Whether the platform currently allows real-money execution. */
async function loadBrokerBridge(supabase: any) {
  const { data } = await supabase.from("settings").select("value").eq("key", "broker_bridge").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, boolean | undefined>;
  return { liveExecutionEnabled: v.liveExecutionEnabled !== false };
}

/**
 * Admin setting that decides which MetaApi token the bridge trades through:
 *   - 'user'    (default) — the user's own token first, general token fallback;
 *   - 'general'            — only the platform-wide METAAPI_TOKEN secret.
 * The raw setting value is validated here so a malformed row can never escape
 * the two allowed modes.
 */
async function loadMetaApiTokenMode(supabase: any): Promise<"user" | "general"> {
  const { data } = await supabase.from("settings").select("value").eq("key", "metaapi_token_mode").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return v.mode === "general" ? "general" : "user";
}

/** Whether the signed-in user has the admin role (server-authoritative). */
async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

/** Start of today (UTC) as unix-ms — used for the daily-loss window. */
function startOfTodayMs(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

/** `masked` = first 6 chars + "…" + last 4 chars, or null when empty. */
function mask(token: string): string | null {
  if (!token) return null;
  if (token.length <= 12) return `${token.slice(0, 3)}…`;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/**
 * Secure token store access — `app_secrets` is RLS-locked (no anon/
 * authenticated policy), so only the service-role client used here can read
 * or write the general MetaApi token. The caller's admin session authorizes
 * the write; no Personal Access Token is involved.
 */
async function storeGet(supabase: any, key: string): Promise<string | null> {
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function storeSet(supabase: any, key: string, value: string): Promise<string | null> {
  const { error } = await supabase.from("app_secrets").upsert({ key, value }, { onConflict: "key" });
  return error?.message ?? null;
}

/** Resolve the platform-wide MetaApi token: secure store first, env fallback. */
async function loadPlatformSecret(supabase: any): Promise<string> {
  const stored = await storeGet(supabase, "METAAPI_TOKEN");
  if (stored) return stored;
  return Deno.env.get("METAAPI_TOKEN")?.trim() ?? "";
}

/**
 * Optional mirror to the project's Edge Function secrets via the Supabase
 * Management API. Only runs when a real PAT (SUPABASE_ACCESS_TOKEN) is set as
 * an env secret; otherwise it is skipped silently — the DB store above is
 * authoritative, so live trading works with no PAT at all.
 * The project ref is derived from SUPABASE_URL, which the runtime injects.
 */
const MANAGEMENT_API = "https://api.supabase.com/v1/projects";

function projectRefFromEnv(): string | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  try {
    const ref = new URL(url).hostname.split(".")[0];
    return /^[a-z0-9]{20}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

async function managementApiSecretWrite(
  method: "POST" | "DELETE",
  payload: unknown,
): Promise<{ ok: boolean; error: string | null }> {
  const pat = Deno.env.get("SUPABASE_ACCESS_TOKEN")?.trim() ?? "";
  if (!pat) {
    return {
      ok: true,
      error: null,
    };
  }
  const ref = projectRefFromEnv();
  if (!ref) {
    return { ok: false, error: "Could not determine the project ref from SUPABASE_URL." };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(`${MANAGEMENT_API}/${ref}/secrets`, {
      method,
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, 20_000);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach the Supabase Management API: ${cause}` };
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    return {
      ok: false,
      error: data.message ?? data.error ?? `The Management API rejected the request (HTTP ${res.status}). Check that the SUPABASE_ACCESS_TOKEN has “Edge Function Secrets” write permission.`,
    };
  }
  return { ok: true, error: null };
}

/** Minimal user shape we expose from `GET /users/current` (never the token). */
interface MetaApiUser {
  email?: string;
  name?: string;
  plan?: string;
  subscriptionType?: string;
  region?: string;
}

/**
 * Validate a MetaApi API token against the provisioning API. Returns
 * `ok:false` with a human-readable reason on rejection/network failure so the
 * security pass always surfaces the real cause instead of a generic error.
 */
async function validateMetaApiToken(token: string): Promise<{
  ok: boolean;
  status: number;
  user: MetaApiUser | null;
  error: string | null;
}> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current`, {
      headers: { "auth-token": token },
    });
  } catch (err) {
    const cause = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, status: 0, user: null, error: `Could not reach MetaApi: ${cause}` };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      user: null,
      error: "MetaApi rejected this API token. Double-check it in your metaapi.cloud dashboard and try again.",
    };
  }
  if (!res.ok) {
    const msg = String(data.error ?? data.message ?? `MetaApi request failed (HTTP ${res.status}).`);
    return { ok: false, status: res.status, user: null, error: msg };
  }
  const plan = (data.plan ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    status: 200,
    user: {
      email: String(data.email ?? ""),
      name: String(data.name ?? ""),
      plan: String(plan.name ?? ""),
      subscriptionType: String(plan.subscriptionType ?? ""),
      region: String(data.region ?? ""),
    },
    error: null,
  };
}

/**
 * Fetch the MetaApi account list for a token and decode a human-readable
 * reason from the response. Never throws: a broken gateway, a rejected token,
 * or a non-JSON body all come back as `ok: false` with a specific `error`.
 */
async function fetchAccountsFor(token: string): Promise<{
  ok: boolean;
  status: number;
  list: Array<Record<string, unknown>>;
  error: string | null;
}> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current/accounts`, {
      headers: { "auth-token": token, "Content-Type": "application/json" },
    });
  } catch (err) {
    const cause = err instanceof Error ? `${err.name}: ${err.message}${err.cause ? ` (${String(err.cause)})` : ""}` : String(err);
    return { ok: false, status: 0, list: [], error: `Could not reach MetaApi (${METAAPI_PROVISIONING_BASE}): ${cause}` };
  }
  const data = (await res.json().catch(() => ({}))) as
    | Array<Record<string, unknown>>
    | { items?: Array<Record<string, unknown>>; error?: string; message?: string };
  const list = Array.isArray(data) ? data : (data.items ?? []);
  if (res.status === 401) {
    return { ok: false, status: res.status, list, error: "MetaApi rejected this API token. Check it in your metaapi.cloud dashboard." };
  }
  if (!res.ok) {
    const body = data as { error?: string; message?: string };
    return { ok: false, status: res.status, list, error: body.error ?? body.message ?? `MetaApi request failed (HTTP ${res.status}).` };
  }
  return { ok: true, status: res.status, list, error: null };
}

/** The MetaApi account object that matches this MT login + server + platform. */
function findMetaApiAccount(
  list: Array<Record<string, unknown>>,
  login: string,
  server: string,
  platform: string,
): { id: string; state?: string; connectionStatus?: string; name?: string; type?: string } | null {
  const match = list.find(
    (a) => String(a.login) === login && String(a.server).toLowerCase() === server.toLowerCase() &&
      String(a.platform).toLowerCase() === platform,
  );
  return match
    ? {
        id: String(match.id),
        state: String(match.state ?? ""),
        connectionStatus: String(match.connectionStatus ?? ""),
        name: String(match.name ?? ""),
        type: String(match.type ?? ""),
      }
    : null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-flight provisioning lock. The Trading page fires `summary`, `open-trades`
 * and `closed-trades` in the same refresh tick, and several robot cycles can
 * overlap; without a lock a first-time account would be created in MetaApi
 * once per parallel call (five creates for one account). The lock makes every
 * waiter share the SAME provisioning promise, so exactly one MetaApi
 * create/deploy happens per connection; the others just await the result.
 */
const provisionLocks = new Map<
  string,
  Promise<{ ok: boolean; state: string | null; accountId: string | null; error: string | null }>
>();

/**
 * AUTO-CONNECT / AUTO-FIX engine: make sure `login@server` exists in MetaApi
 * and is deployed, creating it first if needed (same payload the old explicit
 * "provision" action used — cloud account + deploy on the provisioning host).
 *
 * Returns:
 *   { ok: true,  state: "DEPLOYED" }                    -> ready to trade
 *   { ok: true,  state: "DEPLOYING" | "UNDEPLOYED" ...} -> give it a moment,
 *                                                          callers return the
 *                                                          "deploying" code so
 *                                                          clients auto-poll.
 *   { ok: false, error }                                -> MetaApi's own reason
 *                                                          (server unsupported,
 *                                                          quota, …) surfaced
 *                                                          verbatim.
 *
 * Runs once per connection at a time (in-flight dedupe), and polls a freshly
 * deployed account briefly so the first trading attempt usually lands.
 */
async function ensureMetaAccountDeployed(args: {
  metaHeaders: Record<string, string>;
  apiToken: string;
  conn: MtConnection;
  login: string;
  server: string;
  platform: "mt4" | "mt5";
  password: string;
  provisioningProfileId?: string;
  magic?: number;
}): Promise<{ ok: boolean; state: string | null; accountId: string | null; error: string | null }> {
  const { metaHeaders, apiToken, conn, login, server, platform, password } = args;
  const lockKey = conn.id;
  const inFlight = provisionLocks.get(lockKey);
  if (inFlight) return inFlight;

  const task = (async () => {
    const list = await fetchAccountsFor(apiToken);
    if (!list.ok) {
      return { ok: false, state: null, accountId: null, error: list.error ?? "MetaApi could not list the accounts for this token." };
    }
    let meta = findMetaApiAccount(list.list, login, server, platform);

    if (!meta) {
      // Not in the cloud yet -> create it ("auto-generate & inject from the free
      // provider"). Only real account credentials are sent; the inputs mirror the
      // explicit `provision` / `metaapi-activate` payloads exactly.
      const accountPayload: Record<string, unknown> = {
        name: `Forex Toolkit ${platform.toUpperCase()} ${login}`,
        type: conn.account_type === "live" ? "live" : "demo",
        login,
        password: String(password),
        server,
        platform,
        magic: toNumber(args.magic) || 0,
      };
      if (args.provisioningProfileId) accountPayload.provisioningProfileId = args.provisioningProfileId;
      const createRes = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current/accounts`, {
        method: "POST",
        headers: metaHeaders,
        body: JSON.stringify(accountPayload),
      }, 20_000);
      const created = await createRes.json().catch(() => ({})) as { id?: string; error?: string; message?: string };
      if (!createRes.ok || !created.id) {
        return {
          ok: false,
          state: null,
          accountId: null,
          error: created.error ?? created.message ?? `MetaApi could not provision this account (HTTP ${createRes.status}).`,
        };
      }
      meta = { id: String(created.id), state: "UNDEFINED", connectionStatus: "", name: "", type: "" };
    }

    if (meta.state !== "DEPLOYED" && meta.state !== "DEPLOYING") {
      const deployRes = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current/accounts/${meta.id}/deploy`, {
        method: "POST",
        headers: metaHeaders,
      }, 20_000);
      const deploy = await deployRes.json().catch(() => ({})) as { error?: string; message?: string };
      if (!deployRes.ok) {
        const msg = deploy.error ?? deploy.message ?? `MetaApi could not deploy this account (HTTP ${deployRes.status}).`;
        // "already deploying / already deployed" race is not a failure.
        if (/already deployed|in the process of deployment|deploying/i.test(msg)) {
          return { ok: true, state: meta.state === "DEPLOYING" ? meta.state : "DEPLOYING", accountId: meta.id, error: null };
        }
        return { ok: false, state: null, accountId: meta.id, error: msg };
      }
      meta = { ...meta, state: "DEPLOYING" };
    }

    // A fresh deployment takes ~20-60s to be reachable. Poll briefly (bounded,
    // best-effort) so the calling action usually succeeds on the first attempt
    // instead of bouncing through the "deploying" code a few times.
    let state = meta.state ?? "";
    const HEAD = /^DEPLOYED$/;
    if (!HEAD.test(state)) {
      for (let i = 0; i < 4; i++) {
        await sleep(3000);
        try {
          const stRes = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current/accounts/${meta.id}`, {
            headers: metaHeaders,
          });
          const stData = (await stRes.json().catch(() => ({}))) as { state?: string };
          state = String(stData.state ?? "");
        } catch {
          /* keep polling */
        }
        if (HEAD.test(state)) break;
      }
    }

    return { ok: true, state: HEAD.test(state) ? "DEPLOYED" : "DEPLOYING", accountId: meta.id, error: null };
  })();

  provisionLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    if (provisionLocks.get(lockKey) === task) provisionLocks.delete(lockKey);
  }
}

/** Shape of the loaded broker_connections row (credentials + MetaApi state). */
interface MtConnection {
  id: string;
  api_key: string | null;
  account_id: string | null;
  account_type: string;
  platform: "mt4" | "mt5";
  server: string | null;
  robot_number: number;
  metaapi_token: string | null;
  metaapi_token_masked: string | null;
  metaapi_security: string | null;
  metaapi_security_note: string | null;
  metaapi_token_checked_at: string | null;
  metaapi_meta: Record<string, unknown> | null;
  metaapi_active: boolean | null;
  metaapi_active_at: string | null;
}

/**
 * Notify the admins that a user's own MetaApi token failed and the bridge
 * automatically switched to the platform-wide METAAPI_TOKEN secret so the
 * robot kept trading without a user-visible error. Broadcasts are
 * `user_id = null`, which the notifications policy shows to admins only.
 * Deduplicated: one row per user per 24h, so a broken token never spams the
 * admin feed. Best-effort — a notification hiccup must never fail a trade.
 */
async function notifyMetaFallback(
  supabase: any,
  userId: string,
  email: string | undefined,
  reason: string,
): Promise<void> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", null)
      .eq("type", "warning")
      .eq("title", "MetaApi token fallback")
      .ilike("body", `%${userId}%`)
      .gte("created_at", since);
    if (count && count > 0) return; // already reported this window
    await supabase.from("notifications").insert({
      user_id: null,
      type: "warning",
      title: "MetaApi token fallback",
      body: `User ${email || userId} (${userId}): ${reason} The robot is running on the platform's MetaApi token — no error was shown to the user.`,
      link: "/admin",
    });
  } catch {
    /* notification is best-effort — never break a trade over it */
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST", "PUT"].includes(req.method)) {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return json({ ok: false, error: "Missing authorization." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  // Verify the caller's JWT so only signed-in users can reach their own account.
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ ok: false, error: "Invalid session." }, 401);

  const url = new URL(req.url);
  let action = url.searchParams.get("action") ?? "verify";
  let body: Record<string, unknown> = {};
  if (req.method === "POST" || req.method === "PUT") {
    try {
      body = (await req.json()) as Record<string, unknown>;
      if (body?.action) action = String(body.action);
    } catch {
      /* body is optional for GET-style actions */
    }
  }

  // ---- Admin-only bridge configuration (no broker connection required) ----
  //   metaapi-config     -> read the current token mode + whether the general
  //                         METAAPI_TOKEN secret is set (masked only).
  //   metaapi-mode-set   -> switch between per-user tokens and the general token.
  //   metaapi-token-set  -> replace the general METAAPI_TOKEN secret (Management
  //                         API) and validate it live against MetaApi.
  //   metaapi-token-clear-> remove the general METAAPI_TOKEN secret.
  // All four are server-authoritative: the caller must be an admin in `profiles`,
  // and the raw token is only ever masked in responses — never stored in the DB.
  if (action === "metaapi-config" || action === "metaapi-mode-set" ||
      action === "metaapi-token-set" || action === "metaapi-token-clear") {
    const admin = await isAdmin(supabase, user.id);
    if (!admin) return json({ ok: false, error: "Admins only." }, 403);
    const tokenMode = await loadMetaApiTokenMode(supabase);
    const platformSecret = await loadPlatformSecret(supabase);
    if (action === "metaapi-config") {
      return json({
        ok: true,
        mode: tokenMode,
        generalTokenConfigured: !!platformSecret,
        generalTokenMasked: mask(platformSecret) ?? null,
      });
    }
    if (action === "metaapi-token-set") {
      const newToken = String(body.token ?? "").trim();
      if (newToken.length < 20) {
        return json({ ok: false, error: "That doesn't look like a MetaApi API token (it should be at least 20 characters, from metaapi.cloud)." }, 400);
      }
      // Primary: secure app store — always works, authorized by the admin's
      // signed-in session (no Personal Access Token required).
      const dbErr = await storeSet(supabase, "METAAPI_TOKEN", newToken);
      if (dbErr) return json({ ok: false, error: `Could not store the MetaApi token: ${dbErr}` }, 500);
      // Optional mirror to Edge Function secrets when a PAT is configured.
      let mirrorNote = "";
      const mirror = await managementApiSecretWrite("POST", [{ name: "METAAPI_TOKEN", value: newToken }]);
      if (!mirror.ok) mirrorNote = ` (platform-secret mirror skipped: ${mirror.error})`;
      // Validate the saved token live so a typo'd or revoked token is caught
      // the moment the admin saves it (it is the live secret either way).
      const validation = await validateMetaApiToken(newToken);
      return json({
        ok: true,
        mode: tokenMode,
        generalTokenConfigured: true,
        generalTokenMasked: mask(newToken) ?? null,
        valid: validation.ok,
        note: validation.ok
          ? `General MetaApi token saved ✓ — MetaApi accepted it${validation.user?.email ? ` (${validation.user.email})` : ""}. The bridge now trades through this token in general mode.${mirrorNote}`
          : `Token saved, but MetaApi rejected it: ${validation.error} — live trading with it will fail the security pass. Save the correct token or clear this one.${mirrorNote}`,
      });
    }
    if (action === "metaapi-token-clear") {
      await supabase.from("app_secrets").delete().eq("key", "METAAPI_TOKEN");
      await managementApiSecretWrite("DELETE", ["METAAPI_TOKEN"]); // best-effort mirror
      return json({
        ok: true,
        mode: tokenMode,
        generalTokenConfigured: false,
        generalTokenMasked: null,
        note: "General MetaApi token removed — the platform token is cleared. Live trading via the general token is disabled until a new one is saved.",
      });
    }
    const nextMode = String(body.mode ?? "").trim();
    if (nextMode !== "user" && nextMode !== "general") {
      return json({ ok: false, error: "metaapi_token_mode must be 'user' or 'general'." }, 400);
    }
    const { error: upsertErr } = await supabase
      .from("settings")
      .upsert(
        { key: "metaapi_token_mode", value: { mode: nextMode }, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (upsertErr) {
      return json({ ok: false, error: `Could not save the MetaApi token mode: ${upsertErr.message}` }, 500);
    }
    return json({ ok: true, mode: nextMode, generalTokenConfigured: !!platformSecret, generalTokenMasked: mask(platformSecret) ?? null });
  }

  // Load the user's MetaTrader connection (platform = mt4 | mt5). A connection
  // is addressed by, in priority order:
  //   connection_id  -> the exact broker_connections row (uuid)
  //   broker_id      -> the broker row (uuid) this connection belongs to
  //   robot_number   -> the robot slot (default 1)
  // Addressing by id lets a user connect SEVERAL MT4/5 brokers side by side
  // (FBS MT4, FXGT MT5, …) without them colliding on a shared robot slot: each
  // broker card / live mode sends the id of its own connection. The robot-slot
  // fallback keeps the historical "first by slot" behaviour, ordered by
  // created_at so a duplicate slot never 500s.
  const connectionId = String(body.connection_id ?? url.searchParams.get("connection_id") ?? "").trim();
  const brokerId = String(body.broker_id ?? url.searchParams.get("broker_id") ?? "").trim();
  const robotNumber = Number(body.robot_number ?? url.searchParams.get("robot_number") ?? 1);

  let connQuery = supabase
    .from("broker_connections")
    .select(
      "id, api_key, account_id, account_type, platform, server, robot_number, " +
        "metaapi_token, metaapi_token_masked, metaapi_security, metaapi_security_note, " +
        "metaapi_token_checked_at, metaapi_meta, metaapi_active, metaapi_active_at",
    )
    .eq("user_id", user.id)
    .in("platform", ["mt4", "mt5"]);
  if (connectionId) connQuery = connQuery.eq("id", connectionId).maybeSingle();
  else if (brokerId) connQuery = connQuery.eq("broker_id", brokerId).maybeSingle();
  else connQuery = connQuery.eq("robot_number", robotNumber).order("created_at", { ascending: true }).limit(1).maybeSingle();
  const { data: conn, error: connErr } = await connQuery;
  if (connErr) return json({ ok: false, error: "Could not load your broker connection." }, 500);
  if (!conn?.api_key || !conn.account_id || !conn.server) {
    return json({
      ok: false,
      error: "No MetaTrader connection saved. Add your MT4/MT5 account login, password and server on the Brokers page first.",
    }, 400);
  }

  const platform = conn.platform as "mt4" | "mt5";
  const login = String(conn.account_id);
  const server = String(conn.server);
  // api_key holds the MT account password, stored encrypted at rest
  // (guard_broker_cred_encrypt trigger). Decrypt server-side with the
  // service-role-only RPC before provisioning.
  const { data: password, error: decryptErr } = await supabase.rpc("decrypt_broker_cred", { p_enc: conn.api_key });
  if (decryptErr || !password) {
    return json({ ok: false, error: "Could not read your saved MetaTrader credentials." }, 500);
  }

  /**
   * Resolve which MetaApi token this connection trades through, honoring the
   * admin setting `settings.metaapi_token_mode`:
   *   - 'user'    (default) — the user's own saved token first, then the
   *                           platform-wide METAAPI_TOKEN secret;
   *   - 'general'           — ONLY the platform-wide METAAPI_TOKEN secret; the
   *                           user's saved token (if any) is ignored.
   * The user's token is decrypted server-side; neither token ever reaches the
   * browser.
   *
   * AUTOMATIC RUNTIME FALLBACK: for robot/trading actions the user's own token
   * is live-validated and used when MetaApi accepts it. When MetaApi rejects
   * it (revoked / invalid / throttled / unreachable) the bridge silently
   * switches to the platform-wide METAAPI_TOKEN secret so the robot keeps
   * running — the user is never shown an error, and the admins get ONE
   * notification per user per day instead. Diagnostic actions (metaapi-status,
   * metaapi-check) resolve honestly so the Brokers page shows the true state
   * of the USER's token; metaapi-save / metaapi-remove never hard-fail on a
   * broken saved token (the user must always be able to replace or remove it).
   */
  const tokenMode = await loadMetaApiTokenMode(supabase);
  const platformSecret = await loadPlatformSecret(supabase);
  let userToken: string | null = null;
  if (conn.metaapi_token) {
    const { data: dec, error: decErr2 } = await supabase.rpc("decrypt_broker_cred", { p_enc: conn.metaapi_token });
    if (decErr2) {
      return json({ ok: false, error: "Could not read your saved MetaApi token. Remove and re-add it on the Brokers page." }, 500);
    }
    userToken = dec ? String(dec).trim() : null;
  }

  /** Actions that must report the truth about the USER's own token (no silent
   *  switch) and actions that never need the resolved token at all. */
  const tokenDiagnosticAction = action === "metaapi-status" || action === "metaapi-check";
  const tokenFreeAction = action === "metaapi-save" || action === "metaapi-remove";

  let metaApiToken: string | null;
  let tokenSource: MetaTokenSource | null;
  /** Set when the user's own token failed live validation and the bridge moved
   *  to the platform token (or found nothing) — drives the admin notification. */
  let tokenFallbackReason: string | null = null;

  if (tokenMode === "general") {
    metaApiToken = platformSecret || null;
    tokenSource = platformSecret ? "general" : null;
  } else if (tokenDiagnosticAction || !userToken || tokenFreeAction) {
    // Classic resolution: the user's own token first, platform token as the
    // pre-set fallback. No live probing — token-free actions must never be
    // blocked by a broken saved token, and diagnostics must show the truth.
    metaApiToken = userToken ?? (platformSecret || null);
    tokenSource = userToken ? "user" : platformSecret ? "general" : null;
  } else {
    // Robot/trading action with a user's own token: try it FIRST, and when
    // MetaApi rejects it switch automatically to the platform token so the
    // robot keeps working — the user sees no error, admins get notified.
    const resolved = await resolveTokenWithFallback({
      mode: "user",
      userToken,
      platformToken: platformSecret,
      check: async (candidate) => {
        const validation = await validateMetaApiToken(candidate);
        return { ok: validation.ok, reason: validation.error ?? undefined };
      },
    });
    metaApiToken = resolved.token;
    tokenSource = resolved.source;
    tokenFallbackReason = resolved.fallbackReason;
  }

  if (!metaApiToken && !tokenFreeAction) {
    return json({
      ok: false,
      code: "no_metaapi_token",
      error: tokenMode === "general"
        ? "No general MetaApi token is configured. An admin needs to set the METAAPI_TOKEN secret before live trading can work."
        : "No MetaApi token available for live trading. Add your own free MetaApi token on the Brokers page (or ask the admin to set the METAAPI_TOKEN secret).",
    }, 503);
  }
  const metaHeaders = { "auth-token": metaApiToken as string, "Content-Type": "application/json" };

  // The user HAS a saved token but the bridge silently moved to the platform
  // token so the robot could keep trading: notify the admins (one per day),
  // never surface an error to the user.
  if (tokenFallbackReason && userToken && !tokenFreeAction) {
    await notifyMetaFallback(supabase, user.id, (user as { email?: string }).email, tokenFallbackReason);
  }

  /**
   * Run the SECURITY PASS for a token against this connection's MT account:
   *  1. token validity — `GET /users/current` must accept it;
   *  2. account control — is the connected MT account (login/server/platform)
   *     present under that token's MetaApi user?
   * A valid token always passes; `accountFound` tells activation whether it can
   * skip provisioning. A token that cannot even be validated fails with the
   * exact MetaApi reason.
   */
  async function securityPass(apiToken: string): Promise<{
    verdict: "passed" | "failed";
    accountFound: boolean;
    state: string | null;
    connectionStatus: string | null;
    user: MetaApiUser | null;
    note: string;
  }> {
    const validation = await validateMetaApiToken(apiToken);
    if (!validation.ok) {
      return {
        verdict: "failed",
        accountFound: false,
        state: null,
        connectionStatus: null,
        user: null,
        note: validation.error ?? "MetaApi could not validate this token.",
      };
    }
    const accounts = await fetchAccountsFor(apiToken);
    if (!accounts.ok) {
      return {
        verdict: "failed",
        accountFound: false,
        state: null,
        connectionStatus: null,
        user: validation.user,
        note: accounts.error ?? "MetaApi could not list your accounts.",
      };
    }
    const match = findMetaApiAccount(accounts.list, login, server, platform);
    const account = match
      ? `It controls MT account #${login} on ${server}.`
      : `MT account #${login} isn't in this MetaApi user's cloud yet — activating will auto-provision it there (free MetaApi provider).`;
    return {
      verdict: "passed",
      accountFound: !!match,
      state: match?.state ?? null,
      connectionStatus: match?.connectionStatus ?? null,
      user: validation.user,
      note: `Token valid. ${account}`,
    };
  }

  /** Persist the security-pass result + optional new token onto the connection. */
  async function persistMetaApiState(fields: Record<string, unknown>): Promise<{ error: string | null }> {
    const { error } = await supabase
      .from("broker_connections")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", conn.id)
      .eq("user_id", user.id);
    return { error: error?.message ?? null };
  }

  /** `metaapi-status` / `metaapi-save` / `metaapi-check` shared response shape. */
  function statusPayload(extra: Record<string, unknown> = {}) {
    return {
      ok: true,
      hasUserToken: !!conn.metaapi_token,
      masked: conn.metaapi_token_masked,
      security: conn.metaapi_security ?? "none",
      securityNote: conn.metaapi_security_note,
      checkedAt: conn.metaapi_token_checked_at,
      active: !!conn.metaapi_active,
      activeAt: conn.metaapi_active_at,
      meta: conn.metaapi_meta,
      mode: tokenMode,
      tokenSource,
      platformTokenConfigured: !!platformSecret,
      ...extra,
    };
  }

  try {
    if (action === "verify") {
      // One request to MetaApi: the account list is fetched once and matched
      // locally. On failure, MetaApi's own reason is surfaced to the user
      // instead of a generic "check the network" message.
      const accounts = await fetchAccountsFor(metaApiToken);
      if (!accounts.ok) {
        return json({ ok: false, error: accounts.error ?? "Could not reach MetaApi. Check the network and try again." }, 502);
      }
      const meta = findMetaApiAccount(accounts.list, login, server, platform);
      return json({
        ok: true,
        provisioned: !!meta,
        state: meta?.state ?? null,
        connectionStatus: meta?.connectionStatus ?? null,
        platform,
        login,
        server,
      });
    }

    if (action === "metaapi-status") {
      // Lightweight local read — no MetaApi call. `accountFound` is best-effort
      // when a token is configured (a MetaApi hiccup must not block the panel).
      let accountFound: boolean | null = null;
      let state: string | null = null;
      let connectionStatus: string | null = null;
      try {
        const accounts = await fetchAccountsFor(metaApiToken);
        if (accounts.ok) {
          const meta = findMetaApiAccount(accounts.list, login, server, platform);
          accountFound = !!meta;
          state = meta?.state ?? null;
          connectionStatus = meta?.connectionStatus ?? null;
        }
      } catch {
        /* keep the panel usable when MetaApi is down */
      }
      return json(statusPayload({ accountFound, state, connectionStatus }));
    }

    if (action === "metaapi-save") {
      if (tokenMode === "general") {
        return json({
          ok: false,
          error: "The platform is set to use the general MetaApi token (admin setting) — per-user tokens are disabled. Ask an admin to switch the setting back to per-user tokens if you want to add your own.",
        }, 400);
      }
      const newToken = String(body.token ?? "").trim();
      if (newToken.length < 20) {
        return json({ ok: false, error: "That doesn't look like a MetaApi API token (it should be at least 20 characters, from metaapi.cloud)." }, 400);
      }
      // Momentarily mark the check as in-flight, then run the security pass.
      await persistMetaApiState({ metaapi_security: "checking" });
      conn.metaapi_security = "checking";
      const pass = await securityPass(newToken);
      const checkedAt = new Date().toISOString();
      const saveErr = await persistMetaApiState({
        metaapi_token: newToken, // plaintext → guard trigger encrypts at rest
        metaapi_token_masked: mask(newToken),
        metaapi_security: pass.verdict,
        metaapi_security_note: pass.note,
        metaapi_token_checked_at: checkedAt,
        metaapi_meta: pass.user as unknown as Record<string, unknown> | null,
        metaapi_active: false,
        metaapi_active_at: null,
      });
      if (saveErr.error) return json({ ok: false, error: `Could not save your MetaApi token: ${saveErr.error}` }, 500);
      Object.assign(conn, {
        metaapi_token: newToken,
        metaapi_token_masked: mask(newToken),
        metaapi_security: pass.verdict,
        metaapi_security_note: pass.note,
        metaapi_token_checked_at: checkedAt,
        metaapi_meta: pass.user,
        metaapi_active: false,
        metaapi_active_at: null,
      });
      return json(statusPayload({
        security: pass.verdict,
        securityNote: pass.note,
        checkedAt,
        accountFound: pass.accountFound,
        state: pass.state,
        connectionStatus: pass.connectionStatus,
      }));
    }

    if (action === "metaapi-check") {
      await persistMetaApiState({ metaapi_security: "checking" });
      conn.metaapi_security = "checking";
      const pass = await securityPass(metaApiToken);
      const checkedAt = new Date().toISOString();
      const saveErr = await persistMetaApiState({
        metaapi_security: pass.verdict,
        metaapi_security_note: pass.note,
        metaapi_token_checked_at: checkedAt,
        metaapi_meta: pass.user as unknown as Record<string, unknown> | null,
      });
      if (saveErr.error) return json({ ok: false, error: `Could not save the check result: ${saveErr.error}` }, 500);
      Object.assign(conn, {
        metaapi_security: pass.verdict,
        metaapi_security_note: pass.note,
        metaapi_token_checked_at: checkedAt,
        metaapi_meta: pass.user,
      });
      return json(statusPayload({
        security: pass.verdict,
        securityNote: pass.note,
        checkedAt,
        accountFound: pass.accountFound,
        state: pass.state,
        connectionStatus: pass.connectionStatus,
      }));
    }

    if (action === "metaapi-activate") {
      // The security pass gates activation: re-run it now rather than trusting
      // a stored verdict, so a revoked token can never keep a connection active.
      const pass = await securityPass(metaApiToken);
      if (pass.verdict !== "passed") {
        return json({ ok: false, error: pass.note, security: "failed", securityNote: pass.note }, 400);
      }

      // Already provisioned + deployed → just flip the connection active.
      if (pass.accountFound && pass.state === "DEPLOYED") {
        const saveErr = await persistMetaApiState({
          metaapi_security: "passed",
          metaapi_security_note: pass.note,
          metaapi_token_checked_at: new Date().toISOString(),
          metaapi_meta: pass.user as unknown as Record<string, unknown> | null,
          metaapi_active: true,
          metaapi_active_at: new Date().toISOString(),
        });
        if (saveErr.error) return json({ ok: false, error: `Could not activate the connection: ${saveErr.error}` }, 500);
        return json({ ok: true, note: "MetaApi security pass complete — account already deployed and live trading is active." });
      }

      // Provision through the AUTO-CONNECT engine (same code path the first
      // live-trading attempt uses, with in-flight dedupe so parallel clicks
      // create the account exactly once).
      const provisioned = await ensureMetaAccountDeployed({
        metaHeaders,
        apiToken: metaApiToken,
        conn,
        login,
        server,
        platform,
        password: String(password ?? ""),
        provisioningProfileId: String(body.provisioningProfileId ?? "").trim() || undefined,
        magic: toNumber(body.magic),
      });
      if (!provisioned.ok) {
        return json({ ok: false, code: "provision_failed", error: provisioned.error ?? "MetaApi could not provision this account." }, 400);
      }

      const now = new Date().toISOString();
      const saveErr = await persistMetaApiState({
        metaapi_security: "passed",
        metaapi_security_note: pass.note,
        metaapi_token_checked_at: now,
        metaapi_meta: pass.user as unknown as Record<string, unknown> | null,
        metaapi_active: true,
        metaapi_active_at: now,
      });
      if (saveErr.error) return json({ ok: false, error: `Could not save the activation state: ${saveErr.error}` }, 500);
      return json({
        ok: true,
        code: provisioned.state === "DEPLOYED" ? "deployed" : "deploying",
        state: provisioned.state,
        note: provisioned.state === "DEPLOYED"
          ? "MetaApi security pass complete — account deployed and live trading is active."
          : "MetaApi security pass complete — account provisioned and deploying on the free MetaApi cloud. Live trading activates in about a minute.",
      });
    }

    if (action === "metaapi-remove") {
      if (tokenMode === "general") {
        return json({
          ok: false,
          error: "The platform is set to use the general MetaApi token — per-user tokens are disabled, so there is nothing to remove.",
        }, 400);
      }
      const saveErr = await persistMetaApiState({
        metaapi_token: null,
        metaapi_token_masked: null,
        metaapi_security: "none",
        metaapi_security_note: null,
        metaapi_token_checked_at: null,
        metaapi_meta: null,
        metaapi_active: false,
        metaapi_active_at: null,
      });
      if (saveErr.error) return json({ ok: false, error: `Could not remove your MetaApi token: ${saveErr.error}` }, 500);
      return json({ ok: true });
    }

    if (action === "provision") {
      // Create the MT account in MetaApi, then deploy it to their cloud
      // (same AUTO-CONNECT engine the first live-trading attempt uses, so
      // manual and automatic provisioning always agree).
      const provisioned = await ensureMetaAccountDeployed({
        metaHeaders,
        apiToken: metaApiToken,
        conn,
        login,
        server,
        platform,
        password: String(password ?? ""),
        provisioningProfileId: String(body.provisioningProfileId ?? "").trim() || undefined,
        magic: toNumber(body.magic),
      });
      if (!provisioned.ok) {
        return json({ ok: false, code: "provision_failed", error: provisioned.error ?? "MetaApi could not provision this account." }, 400);
      }
      return json({
        ok: true,
        metaapiAccountId: provisioned.accountId,
        code: provisioned.state === "DEPLOYED" ? "deployed" : "deploying",
        state: provisioned.state,
        note: provisioned.state === "DEPLOYED"
          ? "Account provisioned and deployed — ready to trade live."
          : "Account provisioned and deploying. Deployment takes about a minute — the app reconnects automatically.",
      });
    }

    // Every action below needs the provisioned + deployed MetaApi account.
    let accountsFor = await fetchAccountsFor(metaApiToken);
    if (!accountsFor.ok) {
      return json({ ok: false, error: accountsFor.error ?? "Could not reach MetaApi. Check the network and try again." }, 502);
    }
    let meta = findMetaApiAccount(accountsFor.list, login, server, platform);
    if (!meta) {
      // AUTO-CONNECT / AUTO-FIX: the account isn't in the MetaApi cloud yet.
      // MetaTrader has no public REST API, so this bridge "create + deploy"
      // step is the ONLY way to reach the account — running it on demand means
      // "save your MT credentials and the app connects" with no manual
      // activation step. In-flight dedupe keeps concurrent refresh calls from
      // racing multiple creates for the same connection.
      console.info(`broker-mt: auto-connecting ${platform} account #${login} on ${server} for user ${user.id.slice(0, 8)}`);
      const provisioned = await ensureMetaAccountDeployed({
        metaHeaders,
        apiToken: metaApiToken,
        conn,
        login,
        server,
        platform,
        password: String(password ?? ""),
      });
      if (!provisioned.ok) {
        return json({ ok: false, code: "provision_failed", error: provisioned.error ?? "MetaApi could not provision this account." }, 400);
      }
      if (provisioned.state !== "DEPLOYED") {
        return json({
          ok: false,
          code: "account_deploying",
          state: provisioned.state,
          error: "MetaTrader account is connecting for the first time (deploying on the MetaApi cloud). The app reconnects automatically in a few seconds.",
        }, 503);
      }
      accountsFor = await fetchAccountsFor(metaApiToken);
      if (!accountsFor.ok) {
        return json({ ok: false, error: accountsFor.error ?? "Could not reach MetaApi. Check the network and try again." }, 502);
      }
      meta = findMetaApiAccount(accountsFor.list, login, server, platform);
      if (!meta) {
        return json({ ok: false, code: "provision_failed", error: "MetaApi provisioned the account but it is not visible yet. The app retries automatically." }, 502);
      }
    }

    const accountUrl = `${METAAPI_BASE}/users/current/accounts/${meta.id}`;

    if (action === "state") {
      const res = await fetchWithTimeout(`${accountUrl}/state`, { headers: metaHeaders });
      const data = (await res.json().catch(() => ({}))) as { status?: string; connectedToBroker?: boolean; error?: string; message?: string };
      if (!res.ok) return json({ ok: false, error: data.error ?? data.message ?? "Could not read MetaApi account state." }, 502);
      return json({
        ok: true,
        status: data.status ?? "unknown",
        connectedToBroker: !!data.connectedToBroker,
        connectionStatus: meta.connectionStatus ?? null,
      });
    }

    if (action === "summary") {
      const res = await fetchWithTimeout(`${accountUrl}/account-information`, { headers: metaHeaders });
      const data = (await res.json().catch(() => ({}))) as {
        balance?: number; equity?: number; currency?: string;
        margin?: number; freeMargin?: number; error?: string; message?: string;
      };
      if (!res.ok) return json({ ok: false, error: data.error ?? data.message ?? "MetaApi could not load the account summary." }, 502);
      const balance = toNumber(data.balance);
      return json({
        ok: true,
        account: {
          balance,
          equity: toNumber(data.equity ?? balance),
          currency: String(data.currency ?? "USD").toUpperCase(),
          margin: toNumber(data.margin),
          freeMargin: toNumber(data.freeMargin),
          connectionStatus: meta.connectionStatus ?? null,
        },
      });
    }

    if (action === "open-trades") {
      const res = await fetchWithTimeout(`${accountUrl}/positions`, { headers: metaHeaders });
      const data = (await res.json().catch(() => ({}))) as { positions?: Array<Record<string, unknown>>; error?: string; message?: string };
      if (!res.ok || !data.positions) {
        return json({ ok: false, error: data.error ?? data.message ?? "MetaApi could not load open positions." }, 502);
      }
      return json({ ok: true, positions: data.positions });
    }

    if (action === "closed-trades") {
      const days = Math.min(90, Math.max(1, Number(body.days ?? 30)));
      const end = Date.now();
      const start = end - days * 24 * 60 * 60 * 1000;
      const res = await fetchWithTimeout(
        `${accountUrl}/history-orders?startTime=${start}&endTime=${end}&limit=${Number(body.limit ?? 100)}`,
        { headers: metaHeaders },
      );
      const data = (await res.json().catch(() => ({}))) as { historyOrders?: Array<Record<string, unknown>>; error?: string; message?: string };
      if (!res.ok || !data.historyOrders) {
        return json({ ok: false, error: data.error ?? data.message ?? "MetaApi could not load trade history." }, 502);
      }
      // Only fully filled orders represent real closed trades.
      const filled = data.historyOrders.filter((o) => String(o.state) === "ORDER_STATE_FILLED");
      return json({ ok: true, trades: filled });
    }

    if (action === "open-position") {
      const symbol = mtSymbol(String(body.symbol ?? ""));
      if (!symbol) return json({ ok: false, error: "Missing symbol." }, 400);
      const units = Math.round(toNumber(body.units));
      if (!Number.isFinite(units) || units <= 0) return json({ ok: false, error: "Invalid order size (units)." }, 400);
      const side = String(body.side ?? "long");
      if (side !== "long" && side !== "short") return json({ ok: false, error: "Invalid side." }, 400);

      const volume = Math.max(0.01, Math.round((units / UNITS_PER_LOT) * 100) / 100);
      const order: Record<string, unknown> = {
        symbol,
        type: side === "long" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
        actionType: "ORDER_TYPE_MARKET",
        volume,
        comment: String(body.strategy ?? "").slice(0, 40),
      };
      const stopLoss = toNumber(body.stopLoss);
      const takeProfit = toNumber(body.takeProfit);
      if (stopLoss <= 0) {
        return json({ ok: false, error: "A stop loss is required on every order." }, 400);
      }
      if (takeProfit > 0) {
        // Side-consistency guard: a long's target must sit above its stop and a
        // short's below it. An inverted pair would otherwise put real money at
        // risk on a live MT account.
        const consistent = side === "long" ? takeProfit > stopLoss : takeProfit < stopLoss;
        if (!consistent) {
          return json({ ok: false, error: "Take-profit is on the wrong side of the stop loss." }, 400);
        }
      }
      // ---- Server-side risk enforcement (client cannot override) ----
      const risk = await loadRiskLimits(supabase);
      const maxUnits = MAX_LOTS_PER_ORDER * UNITS_PER_LOT;
      if (units > maxUnits) {
        return json({ ok: false, error: `Order size exceeds the server-side maximum of ${MAX_LOTS_PER_ORDER} lots.` }, 400);
      }
      const liveGate = await loadBrokerBridge(supabase);
      if (conn.account_type === "live" && liveGate.liveExecutionEnabled === false) {
        return json({ ok: false, error: "Live execution is currently disabled by the platform. Switch to a demo account." }, 400);
      }
      const posRes = await fetchWithTimeout(`${accountUrl}/positions`, { headers: metaHeaders });
      const posData = (await posRes.json().catch(() => ({}))) as { positions?: Array<{ symbol?: string }> };
      const openForSymbol = (posData.positions ?? []).filter((p) => String(p.symbol).toUpperCase() === symbol).length;
      if (openForSymbol >= risk.maxOpenPositions) {
        return json({ ok: false, error: `Maximum ${risk.maxOpenPositions} open position(s) reached for ${symbol}. Close one first.` }, 400);
      }

      const res = await fetchWithTimeout(`${accountUrl}/trading/orders`, {
        method: "POST",
        headers: metaHeaders,
        body: JSON.stringify(order),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; message?: string; numericCode?: number };
      if (!res.ok) {
        const reason = data.error ?? data.message ?? `MetaApi rejected the order (code ${data.numericCode ?? "?"}).`;
        return json({ ok: false, error: reason }, 400);
      }
      return json({ ok: true, orderId: data.id ?? null });
    }

    if (action === "close-position") {
      const positionId = String(body.positionId ?? "").trim();
      if (!positionId) return json({ ok: false, error: "Missing position id." }, 400);
      const res = await fetchWithTimeout(`${accountUrl}/trading/positions/${positionId}/close`, {
        method: "POST",
        headers: metaHeaders,
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; profit?: number; error?: string; message?: string; numericCode?: number };
      if (!res.ok) {
        const reason = data.error ?? data.message ?? `MetaApi could not close the position (code ${data.numericCode ?? "?"}).`;
        return json({ ok: false, error: reason }, 400);
      }
      return json({ ok: true, profit: toNumber(data.profit) || null });
    }

    return json({ ok: false, error: `Unknown action '${action}'.` }, 400);
  } catch (err) {
    // Surface whatever actually went wrong when we know it — a failed fetch, a
    // bad response body, or a bug in a handler — and only fall back to the
    // generic "check the network" copy when there is no more specific reason.
    const detail = err instanceof Error ? err.message.trim() : "";
    if (/invalid peer certificate|UnknownIssuer|certificate has expired|self[- ]signed/i.test(detail)) {
      return json({
        ok: false,
        error: "MetaApi's trading API is temporarily unreachable from the server (its certificate could not be verified). Your account and settings are safe — please try again in a few minutes.",
      }, 502);
    }
    return json({
      ok: false,
      error: detail ? `MetaApi request failed: ${detail}` : "Could not reach MetaApi. Check the network and try again.",
    }, 502);
  }
});
