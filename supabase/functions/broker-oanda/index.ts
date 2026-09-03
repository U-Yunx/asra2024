import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

// ---------------------------------------------------------------------------
// OANDA v20 bridge.
//
// The browser NEVER talks to OANDA directly. This function authenticates the
// caller via their Supabase session, loads the user's saved OANDA API key from
// broker_connections (never exposed to the browser), and proxies every
// read/write to the OANDA v20 REST API. Order placement additionally requires
// the per-connection robot REST API token (see broker-token) so a leaked
// session alone can't fire orders.
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OANDA_PRACTICE = "https://api-fxpractice.oanda.com";
const OANDA_LIVE = "https://api-fxtrade.oanda.com";

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

/** Load the caller's OANDA connection (with broker base URLs) — or null. */
async function connectionFor(admin, userId: string) {
  const { data } = await admin
    .from("broker_connections")
    .select("id, account_id, account_type, api_key, brokers(live_url, practice_url)")
    .eq("user_id", userId)
    .eq("platform", "oanda")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** True when the request carries the stored robot REST API token for a connection. */
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

function pipSize(symbol: string): number {
  return /JPY|XAU|XAG/.test(symbol) ? 0.01 : 0.0001;
}

function toOandaSymbol(symbol: string): string {
  return symbol.includes("/") ? symbol.replace("/", "_") : symbol;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const userId = await authorize(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (!action) return json({ error: "bad_request", message: "Missing action." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const conn = await connectionFor(admin, userId);
    if (!conn?.account_id) {
      return json({ ok: false, error: "Connect your OANDA trader account on the Brokers page first." });
    }

    const apiKey = typeof conn.api_key === "string" ? conn.api_key : "";
    if (!apiKey) return json({ ok: false, error: "OANDA API key is missing — reconnect your account." });

    const base =
      conn.account_type === "live"
        ? String(conn.brokers?.live_url ?? OANDA_LIVE)
        : String(conn.brokers?.practice_url ?? OANDA_PRACTICE);
    const accountId = String(conn.account_id);
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    switch (action) {
      case "summary": {
        const res = await fetch(`${base}/v3/accounts/${accountId}/summary`, { headers });
        const data = (await res.json().catch(() => ({}))) as { account?: Record<string, unknown>; errorMessage?: string };
        if (!res.ok || !data.account) {
          return json({ ok: false, error: data.errorMessage ?? "OANDA rejected the request." });
        }
        return json({ ok: true, account: data.account });
      }

      case "open-trades": {
        const res = await fetch(`${base}/v3/accounts/${accountId}/openTrades`, { headers });
        const data = (await res.json().catch(() => ({}))) as { trades?: unknown[]; errorMessage?: string };
        if (!res.ok) return json({ ok: false, error: data.errorMessage ?? "Could not load open trades." });
        return json({ ok: true, trades: data.trades ?? [] });
      }

      case "closed-trades": {
        const res = await fetch(`${base}/v3/accounts/${accountId}/trades?state=CLOSED&count=100`, { headers });
        const data = (await res.json().catch(() => ({}))) as { trades?: unknown[]; errorMessage?: string };
        if (!res.ok) return json({ ok: false, error: data.errorMessage ?? "Could not load trade history." });
        return json({ ok: true, trades: data.trades ?? [] });
      }

      case "open-position": {
        if (!(await validToken(admin, conn.id, body.token))) {
          return json({ ok: false, error: "Invalid or missing robot REST API token. Regenerate it on the Brokers page." });
        }
        const symbol = toOandaSymbol(String(body.symbol ?? ""));
        const side = String(body.side ?? "");
        const units = Math.max(1, Math.round(Number(body.units ?? 0)));
        const stopDistance = Number(body.stopDistance ?? 0);
        const takeProfitDistance = Math.max(0, Number(body.takeProfitDistance ?? 0));
        if (!symbol || (side !== "long" && side !== "short")) {
          return json({ ok: false, error: "Invalid order parameters." });
        }
        if (!(stopDistance > 0)) return json({ ok: false, error: "A stop loss is required on every position." });
        const signedUnits = side === "long" ? units : -units;
        const order = {
          type: "MARKET",
          instrument: symbol,
          units: signedUnits,
          timeInForce: "FOK",
          stopLossOnFill: { distance: String(stopDistance) },
          ...(takeProfitDistance > 0 ? { takeProfitOnFill: { distance: String(takeProfitDistance) } } : {}),
          clientExtensions: {
            comment: typeof body.strategy === "string" && body.strategy ? body.strategy.slice(0, 24) : "robot",
          },
        };
        const res = await fetch(`${base}/v3/accounts/${accountId}/orders`, {
          method: "POST",
          headers,
          body: JSON.stringify({ order }),
        });
        const data = (await res.json().catch(() => ({}))) as { orderFillTransaction?: { tradeOpened?: { tradeID?: string } }; errorMessage?: string };
        if (!res.ok || !data.orderFillTransaction?.tradeOpened?.tradeID) {
          return json({ ok: false, error: data.errorMessage ?? "OANDA rejected the order." });
        }
        return json({ ok: true });
      }

      case "close-position": {
        if (!(await validToken(admin, conn.id, body.token))) {
          return json({ ok: false, error: "Invalid or missing robot REST API token. Regenerate it on the Brokers page." });
        }
        const tradeId = String(body.tradeId ?? "");
        if (!tradeId) return json({ ok: false, error: "Missing trade id." });
        const res = await fetch(`${base}/v3/accounts/${accountId}/trades/${tradeId}/close`, {
          method: "PUT",
          headers,
          body: "{}",
        });
        const data = (await res.json().catch(() => ({}))) as { errorMessage?: string };
        if (!res.ok) return json({ ok: false, error: data.errorMessage ?? "OANDA could not close the position." });
        return json({ ok: true });
      }

      default:
        return json({ error: "bad_request", message: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("broker-oanda error", err);
    return json({ error: "internal", message: "Broker bridge unavailable." }, 500);
  }
});
