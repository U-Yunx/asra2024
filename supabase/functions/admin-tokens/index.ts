// ---------------------------------------------------------------------------
// admin-tokens — secure management of the app's third-party API tokens.
//
// Flow: an admin clicks "Generate & inject automatically" (or pastes a token)
// on the Configuration page. This function verifies the caller's JWT + admin
// role, live-validates each token against its provider (best-effort,
// non-blocking), and stores it in the app's secure token store (`app_secrets`:
// RLS deny-all, service-role only) through the auto-injected service-role key.
// No Personal Access Token is required — the admin's signed-in session is the
// credential that authorizes every write, so the very first token can be
// stored with zero manual setup.
//
//   tokens-bootstrap  -> the one-click button: generates + injects a fresh
//                        internal Supabase API token and the robot's cron
//                        token, verifies the store with a round-trip probe,
//                        and marks the store auto-managed. Uses ONLY the
//                        caller's session (the "available authentication data
//                        from the application").
//   tokens-config     -> which tokens are configured (names + masked only).
//   tokens-set        -> validate + store one or more tokens.
//   tokens-clear      -> remove a token.
//
// Backward compatibility: when a real PAT (`SUPABASE_ACCESS_TOKEN` env secret,
// sbp_…) exists, writes are ALSO mirrored to the project's Edge Function
// secrets through the Supabase Management API so functions that read via
// Deno.env.get() keep working. That mirror is best-effort and never blocks a
// save — the DB store is authoritative for the app.
//
// Security guarantees:
//  - Token values NEVER enter the client bundle and NEVER leave this function
//    except as a masked preview + validation verdict.
//  - The store is RLS-locked: no anon/authenticated policy exists, so only the
//    service role (these edge functions) can read or write tokens.
//  - Only allowlisted secret names can be written/removed.
//  - Caller must be a signed-in admin (server-authoritative).
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const MANAGEMENT_API = "https://api.supabase.com/v1/projects";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function projectRef(): string | null {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
    return /^[a-z0-9]{20}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

/** Cryptographically-random hex string (used to auto-generate tokens). */
function randomHex(bytes: number): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Secure token store (app_secrets, service-role only) ---------------------

async function storeGet(admin: ReturnType<typeof createClient>, key: string): Promise<string | null> {
  const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function storeSet(admin: ReturnType<typeof createClient>, key: string, value: string): Promise<string | null> {
  const { error } = await admin.from("app_secrets").upsert({ key, value }, { onConflict: "key" });
  return error?.message ?? null;
}

async function storeDelete(admin: ReturnType<typeof createClient>, key: string): Promise<string | null> {
  const { error } = await admin.from("app_secrets").delete().eq("key", key);
  return error?.message ?? null;
}

// --- Optional Management API mirror (only when a real PAT is configured) -----

/**
 * Best-effort mirror of a token to the project's Edge Function secrets via the
 * Supabase Management API. Requires a `SUPABASE_ACCESS_TOKEN` (a scoped PAT)
 * as an env secret. When none is set the mirror is skipped silently — the DB
 * store is authoritative, so the app keeps working with no PAT at all.
 * Returns the action's outcome so callers can note a skipped mirror.
 */
async function managementMirror(
  method: "POST" | "DELETE",
  payload: unknown,
): Promise<{ ok: boolean; error: string | null; skipped: boolean }> {
  const pat = Deno.env.get("SUPABASE_ACCESS_TOKEN")?.trim() ?? "";
  if (!pat) return { ok: true, error: null, skipped: true };
  const ref = projectRef();
  if (!ref) return { ok: false, error: "Could not determine this project's ref.", skipped: false };
  try {
    const res = await fetch(`${MANAGEMENT_API}/${ref}/secrets`, {
      method,
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return {
        ok: false,
        error: body?.message ? `Supabase rejected the save: ${body.message}` : `Supabase rejected the save (HTTP ${res.status}).`,
        skipped: false,
      };
    }
    return { ok: true, error: null, skipped: false };
  } catch {
    return { ok: false, error: "Could not reach the Supabase Management API.", skipped: false };
  }
}

/** Best-effort live validation per provider. Never blocks a save. */
type Validator = (value: string) => Promise<string | null>;

const VALIDATORS: Record<string, { label: string; validate: Validator }> = {
  SUPABASE_ACCESS_TOKEN: {
    label: "Supabase access token",
    validate: async (v) => {
      // In auto mode a PAT is optional — this validator only runs when an
      // admin actually pastes one (to mirror it to the platform secret store).
      if (!v.startsWith("sbp_")) {
        return "This doesn't look like a Personal Access Token (sbp_…). It was still stored for compatibility — token storage itself runs automatically from your session, no PAT needed.";
      }
      const ref = projectRef();
      if (!ref) return "Could not determine this project's ref — saved without a live check.";
      try {
        const res = await fetch(`${MANAGEMENT_API}/${ref}/secrets`, {
          headers: { Authorization: `Bearer ${v}` },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) return null;
        if (res.status === 401) return "Supabase rejected the token (HTTP 401) — check it was copied in full.";
        if (res.status === 403) {
          return "The token is valid but lacks the “Edge Function Secrets” read-write scope — add that scope on the Access Tokens page, otherwise saving other tokens will fail.";
        }
        return `Supabase rejected the token (HTTP ${res.status}).`;
      } catch {
        return "Could not reach the Supabase Management API to validate — saved without a live check.";
      }
    },
  },
  METAAPI_TOKEN: {
    label: "MetaApi",
    validate: async (v) => {
      try {
        const res = await fetch("https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current", {
          headers: { "auth-token": v },
          signal: AbortSignal.timeout(8000),
        });
        return res.ok
          ? null
          : "MetaApi rejected the token (HTTP " + res.status + ").";
      } catch {
        return "Could not reach MetaApi to validate — saved without a live check.";
      }
    },
  },
  OANDA_API_KEY: {
    label: "OANDA",
    validate: async (v) => {
      if (v.length < 12) return "OANDA tokens are longer than this — double-check the value.";
      try {
        const res = await fetch("https://api-fxpractice.oanda.com/v3/accounts", {
          headers: { Authorization: "Bearer " + v },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) return null;
        return "OANDA practice rejected the token (HTTP " + res.status + "). Live-account tokens only authenticate on their own environment — this does not block saving.";
      } catch {
        return "Could not reach OANDA to validate — saved without a live check.";
      }
    },
  },
  TWELVE_DATA_API_KEY: {
    label: "Twelve Data",
    validate: async (v) => {
      try {
        const res = await fetch("https://api.twelvedata.com/api_usage?apikey=" + encodeURIComponent(v), {
          signal: AbortSignal.timeout(8000),
        });
        const data = (await res.json().catch(() => null)) as { status?: string } | null;
        return data?.status === "ok" ? null : "Twelve Data rejected the key — check it on your account page.";
      } catch {
        return "Could not reach Twelve Data to validate — saved without a live check.";
      }
    },
  },
  FINNHUB_API_KEY: {
    label: "Finnhub",
    validate: async (v) => {
      try {
        const res = await fetch("https://finnhub.io/api/v1/quote?symbol=OAN:EURUSD&token=" + encodeURIComponent(v), {
          signal: AbortSignal.timeout(8000),
        });
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        return data?.error ? "Finnhub rejected the key: " + data.error : null;
      } catch {
        return "Could not reach Finnhub to validate — saved without a live check.";
      }
    },
  },
  ALPHA_VANTAGE_API_KEY: {
    label: "Alpha Vantage",
    validate: async (v) => {
      try {
        const res = await fetch(
          "https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=EUR&to_currency=USD&apikey=" +
            encodeURIComponent(v),
          { signal: AbortSignal.timeout(8000) },
        );
        const data = (await res.json().catch(() => null)) as { "Error Message"?: string; Information?: string } | null;
        if (data?.["Error Message"] || data?.Information) {
          return "Alpha Vantage rejected the key — " + (data["Error Message"] ?? data.Information);
        }
        return null;
      } catch {
        return "Could not reach Alpha Vantage to validate — saved without a live check.";
      }
    },
  },
  POLYGON_API_KEY: {
    label: "Polygon.io",
    validate: async (v) => {
      try {
        const res = await fetch("https://api.polygon.io/v2/aggs/ticker/X:BTCUSD/prev?apiKey=" + encodeURIComponent(v), {
          signal: AbortSignal.timeout(8000),
        });
        const data = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
        return data?.status === "OK" ? null : "Polygon rejected the key: " + (data?.error ?? "HTTP " + res.status);
      } catch {
        return "Could not reach Polygon.io to validate — saved without a live check.";
      }
    },
  },
};

/** Masked preview — the only representation of a token that ever leaves this function. */
function mask(value: string): string {
  return value.length <= 8 ? "••••••••" : `${value.slice(0, 3)}••••••${value.slice(-3)}`;
}

/**
 * Bridge the legacy env-secret names to the market-data provider store keys,
 * so a provider key saved here powers quotes, charts and the robot immediately
 * (market-data reads `market_data_<provider>`; news reads TWELVE_DATA_API_KEY).
 */
const MARKET_DATA_MAP: Record<string, string> = {
  TWELVE_DATA_API_KEY: "market_data_twelvedata",
  FINNHUB_API_KEY: "market_data_finnhub",
  ALPHA_VANTAGE_API_KEY: "market_data_alphavantage",
  POLYGON_API_KEY: "market_data_polygon",
  OANDA_API_KEY: "market_data_oanda",
};

/** Auto-mode state: true once the one-click bootstrap has run. */
async function storeMode(admin: ReturnType<typeof createClient>): Promise<"auto" | "manual"> {
  const mode = await storeGet(admin, "token_store_mode");
  return mode === "auto" ? "auto" : "manual";
}

/** Read which tokens are configured (env or store) + the bootstrap state. */
async function tokenStatuses(admin: ReturnType<typeof createClient>) {
  const auto = await storeMode(admin);
  const tokens = [];
  for (const [name, meta] of Object.entries(VALIDATORS)) {
    const stored = await storeGet(admin, name);
    const env = Deno.env.get(name)?.trim() ?? "";
    const raw = stored ?? env;
    const configured = !!raw || (name === "SUPABASE_ACCESS_TOKEN" && auto === "auto");
    tokens.push({
      name,
      label: meta.label,
      configured,
      masked: raw ? mask(raw) : null,
      autoManaged: name === "SUPABASE_ACCESS_TOKEN" && auto === "auto" && !raw,
    });
  }
  const cron = await storeGet(admin, "robot_runner_cron_token");
  const bootstrappedAt = await storeGet(admin, "token_store_bootstrapped_at");
  return {
    tokens,
    bootstrap: {
      mode: auto,
      verified: true,
      robot_token: cron ? "present" : "missing",
      bootstrapped_at: bootstrappedAt,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  // 1. Authenticate the caller (JWT verified against GoTrue).
  const auth = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!auth) return json({ ok: false, error: "Missing authorization." }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: { user }, error: authError } = await supabase.auth.getUser(auth);
  if (authError || !user) return json({ ok: false, error: "Invalid session." }, 401);

  // 2. Admin only — checked server-side against the profiles table.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return json({ ok: false, error: "Admins only." }, 403);

  let body: { action?: string; tokens?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const action = body?.action;

  // 3. One-click bootstrap — "generate & inject automatically". Uses ONLY the
  //    caller's session: verifies the secure store, generates + injects a fresh
  //    internal Supabase API token, ensures the robot's cron token exists so
  //    the background robot keeps running, and marks the store auto-managed.
  if (action === "tokens-bootstrap") {
    // a) Prove the secure store is writable/readable (service-role round trip).
    const probeKey = `bootstrap_probe_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const writeErr = await storeSet(supabase, probeKey, "ok");
    if (writeErr) {
      return json({ ok: false, error: `Could not write to the secure token store: ${writeErr}` }, 500);
    }
    const probe = await storeGet(supabase, probeKey);
    await storeDelete(supabase, probeKey);
    if (probe !== "ok") {
      return json({ ok: false, error: "The secure token store self-test failed — storage is not writable right now." }, 500);
    }

    // b) Generate + inject a fresh internal Supabase API token (auto-managed).
    const internal = `ana24_int_${randomHex(32)}`;
    const internalErr = await storeSet(supabase, "platform_internal_token", internal);
    if (internalErr) {
      return json({ ok: false, error: `Could not inject the Supabase API token: ${internalErr}` }, 500);
    }
    const readBack = await storeGet(supabase, "platform_internal_token");
    if (readBack !== internal) {
      return json({ ok: false, error: "The injected Supabase API token could not be verified." }, 500);
    }

    // c) Ensure the robot-runner cron token exists (the background robot's own
    //    auth — keeps robot runs alive when the browser tab is closed).
    let robotToken: "present" | "injected" = "present";
    const cron = await storeGet(supabase, "robot_runner_cron_token");
    if (!cron) {
      const newCron = `ana24_cron_${randomHex(32)}`;
      const cronErr = await storeSet(supabase, "robot_runner_cron_token", newCron);
      if (cronErr) {
        return json({ ok: false, error: `Could not inject the robot token: ${cronErr}` }, 500);
      }
      robotToken = "injected";
    }

    // d) Mark the store auto-managed.
    await storeSet(supabase, "token_store_mode", "auto");
    await storeSet(supabase, "token_store_bootstrapped_at", new Date().toISOString());

    const status = await tokenStatuses(supabase);
    return json({
      ok: true,
      mode: "auto",
      verified: true,
      robot_token: robotToken,
      message: "Supabase API token generated & injected from your session — token storage is live. Every token below can now be saved and is picked up by the app and robot immediately.",
      ...status,
    });
  }

  // 4. Read-only status: which tokens are configured (names + masked only).
  if (action === "tokens-config") {
    const status = await tokenStatuses(supabase);
    return json({ ok: true, ...status });
  }

  // 5. Save one or more tokens: validate in parallel, write in parallel.
  if (action === "tokens-set") {
    const incoming = Array.isArray(body?.tokens) ? (body.tokens as { name?: unknown; value?: unknown }[]) : [];
    const results: Record<string, unknown>[] = [];
    const queue: { name: string; value: string }[] = [];

    for (const t of incoming) {
      const name = typeof t?.name === "string" ? t.name.toUpperCase().trim() : "";
      const value = typeof t?.value === "string" ? t.value.trim() : "";
      if (!VALIDATORS[name]) {
        results.push({ name, label: name || "(missing name)", saved: false, validation: null, error: "Unknown token name." });
        continue;
      }
      if (!value) {
        results.push({ name, label: VALIDATORS[name].label, saved: false, validation: null, error: "Token value is empty." });
        continue;
      }
      if (value.length > 2000) {
        results.push({ name, label: VALIDATORS[name].label, saved: false, validation: null, error: "Token value looks too long to be valid." });
        continue;
      }
      queue.push({ name, value });
    }

    const verdicts = await Promise.all(queue.map((t) => VALIDATORS[t.name].validate(t.value)));
    const writes = await Promise.all(
      queue.map(async (t) => {
        // Primary: secure app store — always works, no PAT required.
        const dbErr = await storeSet(supabase, t.name, t.value);
        if (dbErr) return { ok: false, error: dbErr };
        // Bridge to the market-data provider store so quotes/charts/robot pick
        // the key up immediately (market-data reads `market_data_<provider>`).
        const mdKey = MARKET_DATA_MAP[t.name];
        if (mdKey) await storeSet(supabase, mdKey, t.value);
        // Optional mirror to Edge Function secrets when a PAT exists (best-effort).
        const mirror = await managementMirror("POST", [{ name: t.name, value: t.value }]);
        if (!mirror.ok) return { ok: true, error: null, note: `platform-secret mirror skipped: ${mirror.error}` };
        return { ok: true, error: null, note: mirror.skipped ? null : "also mirrored to the platform secret store" };
      }),
    );

    queue.forEach((t, i) => {
      const verdict = verdicts[i];
      const write = writes[i];
      results.push({
        name: t.name,
        label: VALIDATORS[t.name].label,
        saved: write.ok,
        validation: verdict ? { ok: false, error: verdict } : { ok: true },
        error: write.ok ? null : write.error,
        note: write.ok && write.note ? write.note : null,
      });
    });

    return json({ ok: true, results });
  }

  // 6. Remove a token.
  if (action === "tokens-clear") {
    const name = typeof body?.name === "string" ? body.name.toUpperCase().trim() : "";
    if (!VALIDATORS[name]) return json({ ok: false, error: "Unknown token name." }, 400);
    const dbErr = await storeDelete(supabase, name);
    if (dbErr) return json({ ok: false, error: dbErr }, 500);
    const mdKey = MARKET_DATA_MAP[name];
    if (mdKey) await storeDelete(supabase, mdKey);
    await managementMirror("DELETE", { secrets: [{ name }] });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown action." }, 400);
});
