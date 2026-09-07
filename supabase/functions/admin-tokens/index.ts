// ---------------------------------------------------------------------------
// admin-tokens — secure management of the app's third-party API tokens.
//
// Flow: an admin pastes a token on the Configuration page. This function
// verifies the caller's JWT + admin role, live-validates the token against its
// provider (best-effort, non-blocking), and writes it to the project's Edge
// Function secrets through the Supabase Management API (needs the
// SUPABASE_ACCESS_TOKEN secret — a scoped PAT with "Edge Function Secrets"
// read-write). The app's own Edge Functions then read the secret via
// Deno.env.get() at runtime — that is the "inject to the app" step, no
// redeploy required.
//
// Security guarantees:
//  - Token values NEVER enter the database and NEVER leave this function.
//  - Responses only ever contain a masked preview + a validation verdict.
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

function projectRef(): string | null {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
    return /^[a-z0-9]{20}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

/** Best-effort live validation per provider. Never blocks a save. */
type Validator = (value: string) => Promise<string | null>;

const VALIDATORS: Record<string, { label: string; validate: Validator }> = {
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

/** Write/remove a project secret through the Supabase Management API. */
async function managementApiSecrets(
  method: "POST" | "DELETE",
  payload: unknown,
): Promise<{ ok: boolean; error: string | null }> {
  const pat = Deno.env.get("SUPABASE_ACCESS_TOKEN")?.trim() ?? "";
  if (!pat) {
    return {
      ok: false,
      error:
        "The server has no SUPABASE_ACCESS_TOKEN secret. Add one (a scoped PAT with “Edge Function Secrets” read-write for this project) so tokens can be stored safely.",
    };
  }
  const ref = projectRef();
  if (!ref) return { ok: false, error: "Could not determine this project's ref." };
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
        error: body?.message
          ? `Supabase rejected the save: ${body.message}`
          : `Supabase rejected the save (HTTP ${res.status}).`,
      };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Could not reach the Supabase Management API." };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  // 1. Authenticate the caller (JWT verified against GoTrue).
  const auth = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!auth) return json({ ok: false, error: "Missing authorization." }, 401);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(SUPABASE_URL, serviceKey);

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

  // 3a. Read-only status: which tokens are configured (names + masked only).
  if (action === "tokens-config") {
    const tokens = Object.entries(VALIDATORS).map(([name, meta]) => {
      const raw = Deno.env.get(name)?.trim() ?? "";
      return { name, label: meta.label, configured: !!raw, masked: raw ? mask(raw) : null };
    });
    return json({ ok: true, tokens });
  }

  // 3b. Save one or more tokens: validate in parallel, write in parallel.
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
    const writes = await Promise.all(queue.map((t) => managementApiSecrets("POST", [{ name: t.name, value: t.value }])));

    queue.forEach((t, i) => {
      const verdict = verdicts[i];
      const write = writes[i];
      results.push({
        name: t.name,
        label: VALIDATORS[t.name].label,
        saved: write.ok,
        validation: verdict ? { ok: false, error: verdict } : { ok: true },
        error: write.ok ? null : write.error,
      });
    });

    return json({ ok: true, results });
  }

  // 3c. Remove a token.
  if (action === "tokens-clear") {
    const name = typeof body?.name === "string" ? body.name.toUpperCase().trim() : "";
    if (!VALIDATORS[name]) return json({ ok: false, error: "Unknown token name." }, 400);
    const write = await managementApiSecrets("DELETE", { secrets: [{ name }] });
    return json({ ok: write.ok, error: write.error });
  }

  return json({ ok: false, error: "Unknown action." }, 400);
});
