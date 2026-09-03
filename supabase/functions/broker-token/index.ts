import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

// ---------------------------------------------------------------------------
// Robot REST API token manager.
//
// The broker bridges (broker-oanda / broker-mt) only accept order requests that
// carry a per-connection robot token. This function issues, reads and revokes
// those tokens so the raw token never has to live in the browser. Tokens are
// stored in `broker_tokens` (owner-scoped RLS) and validated server-side by the
// bridge before any order reaches the broker.
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function decodeJwtPayload(token: string): { sub?: string } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const pad = bin.length % 4 === 0 ? "" : "=".repeat(4 - (bin.length % 4));
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad)) as { sub?: string };
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

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "rbt_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mask(token: string): string {
  return token.length <= 10 ? token.slice(0, 6) + "…" : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/** Find the caller's connection for a platform + robot slot. */
async function connectionFor(admin, userId: string, platform: string, robotNumber: number) {
  // The bridge reports MetaTrader accounts as platform "mt"; the catalog stores
  // mt4 / mt5. Normalise so the lookup matches either.
  const platforms = platform === "mt" ? ["mt4", "mt5"] : [platform];
  const { data } = await admin
    .from("broker_connections")
    .select("id, platform, robot_number")
    .eq("user_id", userId)
    .in("platform", platforms)
    .eq("robot_number", robotNumber)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function tokenRow(admin, connectionId: string) {
  const { data } = await admin
    .from("broker_tokens")
    .select("connection_id, platform, token, masked, created_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  return data ?? null;
}

function statusOf(row: { connection_id: string; platform: string | null; token?: string; masked?: string | null; created_at?: string | null } | null, connectionId: string, platform: string) {
  return {
    connection_id: connectionId,
    platform,
    hasToken: !!row?.token,
    masked: row?.masked ?? null,
    created_at: row?.created_at ?? null,
  };
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

    if (action === "get") {
      // Used by the robot loop (broker.ts) to fetch the token for a platform slot.
      const platform = String(body.platform ?? "oanda");
      const robotNumber = Math.max(1, Number(body.robot_number ?? 1));
      const conn = await connectionFor(admin, userId, platform, robotNumber);
      if (!conn) return json({ token: null });
      const row = await tokenRow(admin, conn.id);
      return json({ token: row?.token ?? null });
    }

    const connectionId = String(body.connection_id ?? body.connectionId ?? "");
    if (!connectionId) return json({ error: "bad_request", message: "Missing connection_id." }, 400);

    // Every non-get action is scoped to one of the caller's connections.
    const { data: conn } = await admin
      .from("broker_connections")
      .select("id, platform")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conn) return json({ error: "not_found", message: "Broker connection not found." }, 404);

    const platform = String(conn.platform ?? "oanda");
    const row = await tokenRow(admin, conn.id);

    switch (action) {
      case "status":
        return json(statusOf(row, conn.id, platform));
      case "generate": {
        const token = randomToken();
        const masked = mask(token);
        const { error } = await admin.from("broker_tokens").upsert(
          { connection_id: conn.id, platform, token, masked, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: "connection_id" },
        );
        if (error) return json({ error: "internal", message: "Could not store the token." }, 500);
        return json(statusOf({ connection_id: conn.id, platform, token, masked, created_at: new Date().toISOString() }, conn.id, platform));
      }
      case "revoke": {
        await admin.from("broker_tokens").delete().eq("connection_id", conn.id);
        return json(statusOf(null, conn.id, platform));
      }
      default:
        return json({ error: "bad_request", message: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("broker-token error", err);
    return json({ error: "internal", message: "Token service unavailable." }, 500);
  }
});
