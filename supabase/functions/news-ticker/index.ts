import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

// ---------------------------------------------------------------------------
// news-ticker — market-moving headlines for the bottom-of-page ticker.
//
// Sources (in order of preference, each wrapped so a failure just falls
// through to the next):
//   1. Twelve Data `/news` (uses the TWELVE_DATA_API_KEY secret).
//   2. ForexLive public RSS feed (parsed server-side, no key needed).
//   3. A curated desk feed (guarantees the ticker is never empty).
//
// Responses are cached in-memory (~10 min) so we don't hammer upstream feeds.
// Auth: same as market-data — any valid project credential or session JWT.
// ---------------------------------------------------------------------------

interface NewsItem {
  title: string;
  source: string;
  published_at: string;
  url?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; items: NewsItem[]; source: "live" | "fallback" } | null = null;

// Curated fallback — evergreen themes that move FX/crypto (shown only when no
// live feed is reachable, e.g. quota exhausted or upstream outage).
const CURATED: NewsItem[] = [
  { title: "Fed rate-cut odds shift after stronger-than-expected US jobs print", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "EUR/USD consolidates ahead of ECB policy decision", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Dollar index steadies as traders weigh inflation path", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "BoJ intervention chatter caps USD/JPY upside", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Gold holds near record as real yields ease", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Crude slips as OPEC+ signals higher output ahead", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Bitcoin volatility rises ahead of US CPI release", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Sterling supported by stronger UK retail sales", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Aussie firms as China stimulus hopes build", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Treasury yields ease; rate-sensitive pairs recover", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Swiss franc steady; SNB seen holding rates", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Loonie watches crude; USD/CAD rangebound", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Risk sentiment improves; high-beta FX outperforms", source: "ANA24 desk", published_at: new Date().toISOString() },
  { title: "Eurozone PMI revisions watched for growth signals", source: "ANA24 desk", published_at: new Date().toISOString() },
];

// --- JSON + auth helpers (same conventions as market-data) ------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Service-role client for the secure token store (`app_secrets`, RLS deny-all).
// The Twelve Data key is read from there first (saved via the Configuration
// page's auto token store — no PAT needed) and falls back to the env secret.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }) : null;

async function resolveTwelveDataKey(): Promise<string | null> {
  if (admin) {
    try {
      const { data } = await admin.from("app_secrets").select("value").eq("key", "TWELVE_DATA_API_KEY").maybeSingle();
      const v = data?.value;
      if (typeof v === "string" && v.trim()) return v.trim();
    } catch {
      // fall through to the env secret
    }
  }
  const env = Deno.env.get("TWELVE_DATA_API_KEY")?.trim() ?? "";
  return env || null;
}

const PROJECT_REF =
  (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? "";

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

function isProjectKeyJwt(token: string): boolean {
  if (!PROJECT_REF) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.ref !== "string") return false;
  return payload.ref === PROJECT_REF;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const apikey = req.headers.get("apikey");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (apikey && anon && apikey === anon) return true;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;
  if (anon && token === anon) return true;
  if (isProjectKeyJwt(token)) return true;
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

// --- Feed fetchers ----------------------------------------------------------

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "ANA24/1.0" } });
  } finally {
    clearTimeout(t);
  }
}

function parseTwelveDataNews(data: unknown): NewsItem[] | null {
  const raw = data as { status?: string; data?: Array<Record<string, unknown>> };
  if (!raw || raw.status !== "ok" || !Array.isArray(raw.data)) return null;
  const items: NewsItem[] = [];
  for (const a of raw.data) {
    const title = typeof a.title === "string" ? a.title.trim() : "";
    if (!title) continue;
    items.push({
      title,
      source: typeof a.source === "string" ? a.source : "Twelve Data",
      published_at: typeof a.published_at === "string" ? a.published_at : new Date().toISOString(),
      url: typeof a.url === "string" ? a.url : undefined,
    });
    if (items.length >= 40) break;
  }
  return items.length ? items : null;
}

async function fetchTwelveDataNews(apiKey: string): Promise<NewsItem[] | null> {
  const params = new URLSearchParams({ symbol: "EUR/USD,GBP/USD,USD/JPY,BTC/USD", apikey: apiKey });
  const res = await fetchWithTimeout(`https://api.twelvedata.com/news?${params.toString()}`, 8000);
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as unknown;
  return parseTwelveDataNews(data);
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null && items.length < 40) {
    const block = m[1];
    const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block)?.[1]?.trim() ?? "";
    if (!title) continue;
    const pub = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1]?.trim() ?? "";
    const link = /<link>([\s\S]*?)<\/link>/i.exec(block)?.[1]?.trim() ?? "";
    items.push({
      title: title.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#8217;/g, "'"),
      source: "ForexLive",
      published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      url: link || undefined,
    });
  }
  return items;
}

async function fetchForexLiveRss(): Promise<NewsItem[] | null> {
  const res = await fetchWithTimeout("https://forexlive.com/feed/", 8000);
  if (!res.ok) return null;
  const xml = await res.text();
  const items = parseRss(xml);
  return items.length ? items : null;
}

// --- Handler ----------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authorized = await isAuthorized(req);
    if (!authorized) return json({ error: "unauthorized" }, 401);

    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return json({ items: cache.items, source: cache.source });
    }

    let items: NewsItem[] | null = null;
    let source: "live" | "fallback" = "live";

    const apiKey = await resolveTwelveDataKey();
    if (apiKey) {
      try {
        items = await fetchTwelveDataNews(apiKey);
      } catch {
        items = null;
      }
    }
    if (!items || items.length === 0) {
      try {
        items = await fetchForexLiveRss();
      } catch {
        items = null;
      }
    }
    if (!items || items.length === 0) {
      items = CURATED;
      source = "fallback";
    }

    cache = { at: Date.now(), items, source };
    return json({ items, source });
  } catch (err) {
    console.error("news-ticker error", err);
    return json({ items: CURATED, source: "fallback" });
  }
});