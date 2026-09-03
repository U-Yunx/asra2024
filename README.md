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
push to `main` (SPA fallback and security headers come from `public/_redirects`
and `public/_headers`, which Cloudflare Pages honors natively).

### One-time setup

1. **Create the Pages project** in the Cloudflare dashboard
   (Workers & Pages → Create → Pages → connect a Git repository), or let the
   first workflow run create it. The workflow deploys to a project named
   `ana24` (see `wrangler.toml`).
2. **Create an API token** with the *Cloudflare Pages — Edit* permission:
   Dashboard → My Profile → API Tokens → Create Token.
3. **Add two GitHub Actions secrets** (Settings → Secrets and variables →
   Actions) — never put these in `.env.local` or a `VITE_` variable; they are
   CI-only and must not reach the browser:
   - `CLOUDFLARE_API_TOKEN` — the API token from step 2.
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID (dashboard,
     right-hand sidebar).

That's it. Push to `main` and the workflow runs `npm ci` → `npm test` →
`npm run build` → `wrangler pages deploy ./dist --project-name=ana24`.

To deploy locally instead: `npx wrangler pages deploy` (reads
`wrangler.toml`); log in first with `npx wrangler login`.

## Security

- No secrets in the client bundle. API keys (market data providers, brokers,
  AI) live in Supabase Edge Function secrets and are read with `Deno.env.get`.
- Live broker trading is proxied through server-side bridges; broker
  credentials never reach the browser.
- Row Level Security on all user-scoped tables.

## Testing

`npm test` runs Vitest over `src/**/*.test.ts` — engine reducer, risk math,
strategy indicators, backtests, currency and formatting helpers.