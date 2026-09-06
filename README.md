# ANA24 — Forex & Crypto Trading Robot

Automated trading platform with a free paper-trading account, strategy
backtester, live signals, auto-tune, and secure live trading through OANDA and
MetaTrader — plus a referral/commission system with manual payouts.

## Stack

- **Frontend** — React 18 + TypeScript + Vite + Tailwind CSS v4
- **Charts** — lightweight-charts (candles, equity curves)
- **Backend** — Supabase (Auth, Postgres, Realtime, Edge Functions)
- **Deploy** — Cloudflare Pages, auto-deployed from GitHub on every push to
  `main` (static build via `npm run build`; see `.github/workflows/deploy-cloudflare.yml`)

## Getting started

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (both public/publishable). Without them the app shows
the "Supabase connection required" screen.

## Scripts

| Script            | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Start the Vite dev server                 |
| `npm run build`   | Production build to `dist/`               |
| `npm test`        | Run the Vitest unit tests                 |

## Architecture

- `src/lib/` — pure logic: trading engine, risk math, strategies, indicators,
  backtests, platform API layer (Supabase), formatting, currency conversion.
- `src/hooks/` — React hooks: auth, market data (realtime quotes), platform
  data, saved strategies, paper account.
- `src/components/` — UI kit + shared components.
- `src/pages/` — routes (Home, Dashboard, Trading, Backtester, Signals,
  Strategies, Performance, Referrals, Gateway, Admin, …).
- `supabase/functions/` — Edge Functions: `market-data` (provider proxy),
  `broker-oanda` / `broker-mt` (live broker bridges), `broker-token`
  (scoped robot API tokens), `news-ticker`.

## Deploying to Cloudflare Pages

The repo ships a GitHub Actions workflow (`.github/workflows/deploy-cloudflare.yml`)
that builds the app and deploys it to Cloudflare Pages automatically on every
push to `main`. The deploy step (`node scripts/deploy-cloudflare.mjs`) talks to
the **Cloudflare REST API** directly — it resolves your account from the API
token, auto-creates the Pages project `ana24` if it doesn't exist yet, and
uploads `dist/` (SPA fallback and security headers come from
`public/_redirects` and `public/_headers`, which the script attaches to every
deployment).

### One-time setup

1. **Create an API token** with the *Cloudflare Pages — Edit* permission:
   Dashboard → My Profile → API Tokens → Create Token. Issue it on the account
   you want to deploy to — a **fresh** Cloudflare account works with zero extra
   setup, because the project is created automatically on first deploy.
2. **Add one GitHub Actions secret** (Settings → Secrets and variables →
   Actions) — never put this in `.env.local` or a `VITE_` variable; it is
   CI-only and must not reach the browser:
   - `CLOUDFLARE_API_TOKEN` — the API token from step 1.

   > If you had the old setup, also **delete the `CLOUDFLARE_ACCOUNT_ID` secret**
   > — it is no longer used. (Only if your token can see *multiple* accounts,
   > add a plain `CLOUDFLARE_ACCOUNT_ID` *variable* to pick one.)

That's it. Push to `main` and the workflow runs `npm ci` → `npm test` →
`npm run build` → `node scripts/deploy-cloudflare.mjs`, which reports the live
URL when done. You can also trigger it manually from the **Actions** tab.

To deploy locally instead: build first, then run the same API script with your
token exported:

```bash
CLOUDFLARE_API_TOKEN=... npm run build
CLOUDFLARE_API_TOKEN=... node scripts/deploy-cloudflare.mjs
```

## Security

- No secrets in the client bundle. API keys (market data providers, brokers,
  AI) live in Supabase Edge Function secrets and are read with `Deno.env.get`.
- Live broker trading is proxied through server-side bridges; broker
  credentials never reach the browser.
- Row Level Security on all user-scoped tables.

## Testing

`npm test` runs Vitest over `src/**/*.test.ts` — engine reducer, risk math,
strategy indicators, backtests, currency and formatting helpers.