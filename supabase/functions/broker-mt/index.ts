import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

// ---------------------------------------------------------------------------
// MetaTrader 4/5 bridge (MetaApi REST).
//
// The browser NEVER talks to MetaApi directly. This function authenticates the
// caller via their Supabase session, loads the user's saved MetaApi token from
// broker_connections (never exposed to the browser) and proxies reads/writes to
// the cloud MetaApi gateway for the bound MT4/5 account. Order placement
// additionally requires the per-connection robot REST API token (broker-token).
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const METAAPI_BASE = "https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function decodeJwtPayload(token: string): { sub?: string } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { sub?: string };
  } catch {
    return null;
  }
}

async function authorize(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = decodeJwtPayload(auth.slice(7).trim());
  return payload?.sub ?? null;
}

/** Load the caller's first MT4/5 connection for the given robot slot. */
async function connectionFor(admin, userId: string, robotNumber: number) {
  const { data } = await admin
    .from("broker_connections")
    .select("id, account_id, api_key, platform, robot_number")
    .eq("user_id", userId)
    .in("platform", ["mt4", "mt5"])
    .eq("robot_number", robotNumber)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function validToken(admin, connectionId: string, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !token) return false;
  const { data } = await admin
    .from("broker_tokens")
    .select("token")
    .eq("connection_id", connectionId)
    .eq("token", token)
    .maybeSingle();
  return !!data;
}

/** App "EUR/USD" -> MetaApi "EURUSD". */
function toMetaSymbol(symbol: string): string {
  return symbol.includes("/") ? symbol.replace("/", "") : symbol;
}

function toIsoTime(t: unknown): string {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  // MetaApi timestamps are milliseconds; tolerate seconds.
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

const UNITS_PER_LOT = 100_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const userId = await authorize(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (!action) return json({ error: "bad_request", message: "Missing action." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const robotNumber = Math.max(1, Number(body.robot_number ?? 1));
    const conn = await connectionFor(admin, userId, robotNumber);
    if (!conn?.account_id) {
      return json({ ok: false, error: "Connect your MetaTrader account on the Brokers page first." });
    }

    const apiKey = typeof conn.api_key === "string" ? conn.api_key : "";
    if (!apiKey) return json({ ok: false, error: "MetaApi token is missing — reconnect your account." });

    const accountId = String(conn.account_id);
    const headers = { "auth-token": apiKey, "Content-Type": "application/json" };

    switch (action) {
      case "summary": {
        const res = await fetch(`${METAAPI_BASE}/users/current/accounts/${accountId}/accountInformation`, { headers });
        const data = (await res.json().catch(() => ({}))) as {
          balance?: number;
          equity?: number;
          currency?: string;
          message?: string;
        };
        if (!res.ok) return json({ ok: false, error: data.message ?? "MetaApi rejected the request." });
        return json({
          ok: true,
          account: {
            balance: Number(data.balance ?? 0),
            equity: Number(data.equity ?? data.balance ?? 0),
            currency: String(data.currency ?? "USD"),
          },
        });
      }

      case "open-trades": {
        const res = await fetch(`${METAAPI_BASE}/users/current/accounts/${accountId}/positions`, { headers });
        const data = (await res.json().catch(() => ({}))) as { positions?: unknown[]; message?: string };
        if (!res.ok) return json({ ok: false, error: data.message ?? "Could not load open positions." });
        return json({ ok: true, positions: data.positions ?? [] });
      }

      case "closed-trades": {
        const end = Date.now();
        const start = end - 90 * 24 * 60 * 60 * 1000; // last 90 days
        const res = await fetch(
          `${METAAPI_BASE}/users/current/accounts/${accountId}/historyOrders?startTime=${start}&endTime=${end}`,
          { headers },
        );
        const data = (await res.json().catch(() => ({}))) as { historyOrders?: unknown[]; message?: string };
        if (!res.ok) return json({ ok: false, error: data.message ?? "Could not load trade history." });
        const trades = (data.historyOrders ?? []).filter(
          (o) => (o as { state?: string }).state === "FILLED",
        );
        return json({ ok: true, trades });
      }

      case "open-position": {
        if (!(await validToken(admin, conn.id, body.token))) {
          return json({ ok: false, error: "Invalid or missing robot REST API token. Regenerate it on the Brokers page." });
        }
        const symbol = toMetaSymbol(String(body.symbol ?? ""));
        const side = String(body.side ?? "");
        const units = Math.max(1, Math.round(Number(body.units ?? 0)));
        const stopLoss = Number(body.stopLoss ?? 0);
        const takeProfit = Number(body.takeProfit ?? 0);
        if (!symbol || (side !== "long" && side !== "short")) {
          return json({ ok: false, error: "Invalid order parameters." });
        }
        const volume = units / UNITS_PER_LOT;
        const trade = {
          symbol,
          type: side === "long" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
          volume,
          ...(stopLoss > 0 ? { stopLoss } : {}),
          ...(takeProfit > 0 ? { takeProfit } : {}),
          comment: typeof body.strategy === "string" && body.strategy ? body.strategy.slice(0, 24) : "robot",
        };
        const res = await fetch(`${METAAPI_BASE}/users/current/accounts/${accountId}/trades`, {
          method: "POST",
          headers,
          body: JSON.stringify(trade),
        });
        const data = (await res.json().catch(() => ({}))) as { orderId?: string; message?: string };
        if (!res.ok || !data.orderId) return json({ ok: false, error: data.message ?? "MetaTrader rejected the order." });
        return json({ ok: true, orderId: data.orderId });
      }

      case "close-position": {
        if (!(await validToken(admin, conn.id, body.token))) {
          return json({ ok: false, error: "Invalid or missing robot REST API token. Regenerate it on the Brokers page." });
        }
        const positionId = String(body.positionId ?? "");
        if (!positionId) return json({ ok: false, error: "Missing position id." });
        const res = await fetch(
          `${METAAPI_BASE}/users/current/accounts/${accountId}/positions/${positionId}/close`,
          { method: "POST", headers, body: "{}" },
        );
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        if (!res.ok) return json({ ok: false, error: data.message ?? "MetaTrader could not close the position." });
        return json({ ok: true });
      }

      default:
        return json({ error: "bad_request", message: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("broker-mt error", err);
    return json({ error: "internal", message: "Broker bridge unavailable." }, 500);
  }
});
