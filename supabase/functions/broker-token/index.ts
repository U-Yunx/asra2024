/**
 * broker-token — auto-generate and manage the per-connection REST API token the
 * robot uses for trading.
 *
 * When a user connects a trading account (OANDA / MetaTrader), the platform
 * auto-generates a REST API token derived from that account's information and
 * stores it encrypted at rest on `broker_connections.rest_api_token` (the same
 * guard trigger that protects `api_key`). The robot presents this token on
 * trading actions, and the broker bridges (`broker-oanda`, `broker-mt`) verify
 * it server-side before executing open/close orders.
 *
 * Actions (`action`, passed in the JSON body):
 *   generate -> auto-create a token for the user's connection (by `connection_id`
 *               or `platform`) and return a masked preview + created_at.
 *   status   -> whether a token exists for the connection (+ masked + created_at).
 *   get      -> return the plaintext token to its owner (used by the robot
 *               adapter so it can present it to the bridges).
 *   revoke   -> clear the token (disables robot trading until regenerated).
 *
 * Security: every action verifies the caller's JWT and only ever touches the
 * caller's own connections. The plaintext token is returned only by `get` to the
 * owner over the authenticated session — never in the connection list queries.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/** Return `masked` = first 6 chars + "…" + last 4 chars, or null when empty. */
function mask(token: string): string | null {
  if (!token) return null;
  if (token.length <= 12) return `${token.slice(0, 3)}…`;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/** Random robot trading token, prefixed so it is recognisable in logs. */
function generateToken(platform: string, accountId: string | null): string {
  const raw = new Uint8Array(24);
  crypto.getRandomValues(raw);
  const hex = Array.from(raw)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const accountPart = (accountId ?? "acct").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return `ana24_${platform}_${accountPart}_${hex}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ ok: false, error: "Server is not configured yet." }, 500);
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // ---- Verify the caller's JWT (the function is deployed with verify_jwt off,
  // ---- so we must check it ourselves to stay compatible with the SDK).
  const auth = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!auth) return json({ ok: false, error: "Missing authorization." }, 401);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(auth);
  if (authError || !user) {
    return json({ ok: false, error: "Invalid session. Please sign in again." }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* body optional for status */
  }
  const action = String(body.action ?? "status");
  const platform = String(body.platform ?? "").trim();
  const connectionId = String(body.connection_id ?? "").trim();
  // Match the bridges: MT/MT5 live trading is per robot slot (1 robot = 1
  // account by default), so resolve the token for the same connection the
  // bridge would load (robot_number, default 1). When an explicit
  // connection_id is passed it wins over the slot lookup — the token lives on
  // the connection, and in multi-account layouts the same account may be
  // shared across robots.
  const robotNumber = Number(body.robot_number ?? 1) || 1;

  // Resolve the connection the caller is acting on (own connections only).
  let query = supabase
    .from("broker_connections")
    .select("id, platform, account_id, rest_api_token, rest_api_token_created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (connectionId) {
    query = query.eq("id", connectionId);
  } else {
    query = query.eq("robot_number", robotNumber);
    if (platform === "mt") {
      // The robot adapter only knows it is on MetaTrader, not whether the
      // account is MT4 or MT5 — match either, like the broker-mt bridge.
      query = query.in("platform", ["mt4", "mt5"]);
    } else if (platform) {
      query = query.eq("platform", platform);
    }
  }

  const { data: rows, error: loadErr } = await query;
  if (loadErr) return json({ ok: false, error: "Could not load your broker connection." }, 500);
  const conn = (rows?.[0] ?? null) as
    | { id: string; platform: string; account_id: string | null; rest_api_token: string | null; rest_api_token_created_at: string | null }
    | null;

  if (action === "status") {
    if (!conn) return json({ ok: true, hasToken: false, masked: null, created_at: null });
    const hasToken = Boolean(conn.rest_api_token);
    // Decrypt to build the masked preview (encrypted at rest, never exposed raw).
    let masked: string | null = null;
    if (hasToken) {
      const { data: dec } = await supabase.rpc("decrypt_broker_cred", { p_enc: conn.rest_api_token });
      masked = mask(String(dec ?? ""));
    }
    return json({
      ok: true,
      hasToken,
      masked,
      created_at: conn.rest_api_token_created_at,
      connection_id: conn.id,
      platform: conn.platform,
    });
  }

  if (!conn) {
    return json({ ok: false, error: "Connect a broker first, then generate your robot REST API token." }, 400);
  }

  if (action === "generate") {
    const token = generateToken(conn.platform, conn.account_id);
    const now = new Date().toISOString();
    // Store plaintext — the guard_broker_cred_encrypt trigger encrypts it at rest.
    const { error: saveErr } = await supabase
      .from("broker_connections")
      .update({ rest_api_token: token, rest_api_token_created_at: now })
      .eq("id", conn.id)
      .eq("user_id", user.id);
    if (saveErr) return json({ ok: false, error: "Could not save your REST API token." }, 500);
    return json({ ok: true, masked: mask(token), created_at: now });
  }

  if (action === "get") {
    if (!conn.rest_api_token) {
      return json({ ok: false, error: "No REST API token yet — generate one on the Brokers page." }, 400);
    }
    const { data: dec, error: decErr } = await supabase.rpc("decrypt_broker_cred", { p_enc: conn.rest_api_token });
    if (decErr || !dec) return json({ ok: false, error: "Could not read your REST API token." }, 500);
    return json({ ok: true, token: String(dec) });
  }

  if (action === "revoke") {
    const { error: revokeErr } = await supabase
      .from("broker_connections")
      .update({ rest_api_token: null, rest_api_token_created_at: null })
      .eq("id", conn.id)
      .eq("user_id", user.id);
    if (revokeErr) return json({ ok: false, error: "Could not revoke your REST API token." }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: `Unknown action '${action}'.` }, 400);
});
