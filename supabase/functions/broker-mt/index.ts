/**
 * broker-mt — cloud bridge to the user's MetaTrader 4/5 account via MetaApi.
 *
 * MT4/MT5 are desktop terminals with no public REST API, so a serverless
 * function cannot dial into an account with login/password/server directly.
 * This function proxies every request through MetaApi's cloud gateway
 * (https://metaapi.cloud) — the user's own MetaApi API token is read from the
 * `METAAPI_TOKEN` Edge Function secret, and the MT account credentials
 * (login / password / server) come from the user's saved `broker_connections`
 * row (platform = 'mt4' | 'mt5'), so neither ever reaches the browser.
 *
 * Before the robot can trade, the MT account must be "provisioned" once in
 * MetaApi (see the `provision` action below) and deployed to their cloud.
 *
 * Actions (`action`, passed in the JSON body):
 *   verify          -> validate the METAAPI_TOKEN and report whether the saved
 *                      MT account is provisioned + deployed in MetaApi.
 *   provision       -> create the MT account in MetaApi and deploy it
 *                      (optional body: provisioningProfileId).
 *   state           -> deployment + connection status of the MetaApi account.
 *   summary         -> account-information (balance, equity, currency).
 *   open-trades     -> open positions (the robot's live positions).
 *   closed-trades   -> recently filled history orders (the live journal).
 *   open-position   -> market order with SL/TP (needs symbol/side/units).
 *   close-position  -> close one open position by MetaApi position id.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

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

/** Start of today (UTC) as unix-ms — used for the daily-loss window. */
function startOfTodayMs(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
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

  // The user's own MetaApi token — never exposed to the browser.
  const metaApiToken = Deno.env.get("METAAPI_TOKEN")?.trim();
  if (!metaApiToken) {
    return json({
      ok: false,
      error: "The MetaTrader bridge is not configured yet. The METAAPI_TOKEN secret must be set first.",
    }, 503);
  }
  const metaHeaders = { "auth-token": metaApiToken, "Content-Type": "application/json" };

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

  // Load the user's MetaTrader connection (platform = mt4 | mt5). Multiple
  // robot slots are supported — pick the one requested or the first by slot.
  const robotNumber = Number(body.robot_number ?? url.searchParams.get("robot_number") ?? 1);
  const { data: conn, error: connErr } = await supabase
    .from("broker_connections")
    .select("id, api_key, account_id, account_type, platform, server, robot_number")
    .eq("user_id", user.id)
    .in("platform", ["mt4", "mt5"])
    .eq("robot_number", robotNumber)
    .maybeSingle();
  if (connErr) return json({ ok: false, error: "Could not load your broker connection." }, 500);
  if (!conn?.api_key || !conn.account_id || !conn.server) {
    return json({
      ok: false,
      error: "No MetaTrader connection saved. Add your MT4/MT5 account login, password and server on the Brokers page first.",
    }, 400);
  }

  const platform = conn.platform as "mt4" | "mt5";
  const login = String(conn.account_id);
  // api_key holds the MT account password, stored encrypted at rest
  // (guard_broker_cred_encrypt trigger). Decrypt server-side with the
  // service-role-only RPC before provisioning.
  const { data: password, error: decryptErr } = await supabase.rpc("decrypt_broker_cred", { p_enc: conn.api_key });
  if (decryptErr || !password) {
    return json({ ok: false, error: "Could not read your saved MetaTrader credentials." }, 500);
  }
  const server = String(conn.server);

  /**
   * Fetch the MetaApi account list for the current user token and decode a
   * human-readable reason from the response. Never throws: a broken gateway, a
   * rejected token, or a non-JSON body all come back as `ok: false` with a
   * specific `error` string instead of being lost to a generic catch-all.
   */
  async function fetchAccounts(): Promise<{
    ok: boolean;
    status: number;
    list: Array<Record<string, unknown>>;
    error: string | null;
  }> {
    let res: Response;
    try {
      // The account list is served by the provisioning API host, which can be
      // reachable even when the trading (client) host is having TLS trouble.
      res = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current/accounts`, { headers: metaHeaders });
    } catch (err) {
      const cause = err instanceof Error ? `${err.name}: ${err.message}${err.cause ? ` (${String(err.cause)})` : ""}` : String(err);
      return { ok: false, status: 0, list: [], error: `Could not reach MetaApi (${METAAPI_PROVISIONING_BASE}): ${cause}` };
    }
    const data = (await res.json().catch(() => ({}))) as
      | Array<Record<string, unknown>>
      | { items?: Array<Record<string, unknown>>; error?: string; message?: string };
    const list = Array.isArray(data) ? data : (data.items ?? []);
    if (res.status === 401) {
      return { ok: false, status: res.status, list, error: "MetaApi rejected this API token. Check the METAAPI_TOKEN secret." };
    }
    if (!res.ok) {
      const body = data as { error?: string; message?: string };
      return { ok: false, status: res.status, list, error: body.error ?? body.message ?? `MetaApi request failed (HTTP ${res.status}).` };
    }
    return { ok: true, status: res.status, list, error: null };
  }

  /**
   * Find the MetaApi account object that matches this MT login + server. Pass
   * `prefetched` (from `fetchAccounts`) to reuse a single request; otherwise the
   * list is fetched here and a failure surfaces to the caller's try/catch with
   * the real reason, so it is never misread as "account not provisioned".
   */
  async function findMetaApiAccount(prefetched?: Array<Record<string, unknown>> | null): Promise<{ id: string; state?: string; connectionStatus?: string } | null> {
    let list: Array<Record<string, unknown>>;
    if (prefetched) {
      list = prefetched;
    } else {
      const accounts = await fetchAccounts();
      if (!accounts.ok) throw new Error(accounts.error ?? "MetaApi request failed.");
      list = accounts.list;
    }
    const match = list.find(
      (a) => String(a.login) === login && String(a.server).toLowerCase() === server.toLowerCase() &&
        String(a.platform).toLowerCase() === platform,
    );
    return match ? { id: String(match.id), state: String(match.state ?? ""), connectionStatus: String(match.connectionStatus ?? "") } : null;
  }

  try {
    if (action === "verify") {
      // One request to MetaApi: the account list is fetched once and matched
      // locally. On failure, MetaApi's own reason is surfaced to the user
      // instead of a generic "check the network" message.
      const accounts = await fetchAccounts();
      if (!accounts.ok) {
        return json({ ok: false, error: accounts.error ?? "Could not reach MetaApi. Check the network and try again." }, 502);
      }
      const meta = await findMetaApiAccount(accounts.list);
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

    if (action === "provision") {
      // Create the MT account in MetaApi, then deploy it to their cloud.
      // A provisioningProfileId is optional — if omitted MetaApi creates an
      // implicit provisioning profile from the server address.
      const provisioningProfileId = String(body.provisioningProfileId ?? "").trim();
      const accountPayload: Record<string, unknown> = {
        name: `Forex Toolkit ${platform.toUpperCase()} ${login}`,
        type: conn.account_type === "live" ? "live" : "demo",
        login,
        password,
        server,
        platform,
        magic: toNumber(body.magic) || 0,
      };
      if (provisioningProfileId) accountPayload.provisioningProfileId = provisioningProfileId;

      // Account creation + deployment are served by the provisioning API host
      // (same host that lists accounts) — keep them off the trading host.
      const createRes = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current/accounts`, {
        method: "POST",
        headers: metaHeaders,
        body: JSON.stringify(accountPayload),
      }, 20_000);
      const created = await createRes.json() as { id?: string; error?: string; message?: string };
      if (!createRes.ok || !created.id) {
        return json({ ok: false, error: created.error ?? created.message ?? "MetaApi could not provision this account." }, 400);
      }
      const accountId = created.id;

      const deployRes = await fetchWithTimeout(`${METAAPI_PROVISIONING_BASE}/users/current/accounts/${accountId}/deploy`, {
        method: "POST",
        headers: metaHeaders,
      }, 20_000);
      const deploy = await deployRes.json().catch(() => ({})) as { error?: string; message?: string };
      if (!deployRes.ok) {
        return json({ ok: false, error: deploy.error ?? deploy.message ?? "Provisioned but failed to deploy." }, 502);
      }
      return json({
        ok: true,
        metaapiAccountId: accountId,
        note: "Account provisioned and deploying. Deployment takes about a minute — call `state` or `summary` shortly.",
      });
    }

    // Every action below needs the provisioned + deployed MetaApi account.
    const meta = await findMetaApiAccount();
    if (!meta) {
      return json({
        ok: false,
        error: "This MT account isn't linked to MetaApi yet. Run the connect flow once (provision action) to deploy it to the MetaApi cloud.",
      }, 400);
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
