# Deploying ANA24 to Cloudflare Pages

ANA24 deploys as a static SPA to Cloudflare Pages. All server-side work runs in
Supabase Edge Functions, so the Pages site itself is just the built bundle.

## Prerequisites

- A Cloudflare account with the Pages project `ana24` created.
- `wrangler` installed (it's a devDependency).
- The two public env vars set for the build:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

These are **public** values (URL + publishable/anon key). No real secrets are
ever baked into the bundle.

## Deploy

```bash
npm run predeploy   # checks required env vars are present
npm run deploy      # npm run build && wrangler pages deploy dist --project-name ana24
```

`scripts/check-deploy-env.mjs` exits non-zero if a required variable is
missing, so a broken deploy never ships.

## CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` automates the whole flow on every push to `main`:
`npm ci` → `npm run predeploy` (env guard) → `npm run build` →
`wrangler pages deploy dist --project-name ana24`.

Before the first CI deploy, add to the GitHub repo
(Settings → Secrets and variables → Actions):

| Scope | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Cloudflare Pages: Edit** permission |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (from the dash URL) |
| Secret or variable | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` — public |
| Secret or variable | `VITE_SUPABASE_ANON_KEY` | Publishable/anon key — public |

The Cloudflare token is a real secret and only ever exists in GitHub secrets /
Cloudflare; it is never baked into the bundle.

## Routing

`public/_redirects` serves `/index.html` for every path (SPA fallback) so
client-side routes like `/trading`, `/admin` and `/profile` work on refresh.

## Headers

`public/_headers` hardens the site (CSP, HSTS, frame/clickjack protection,
permissions policy). If you change the Supabase project ref, update the
`connect-src` entries there too.

## Troubleshooting

- **Blank page on refresh** — make sure `_redirects` is present in `dist/`.
- **Supabase calls failing in prod but not locally** — confirm
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set for the Production
  environment (not just Preview).
- **CSP blocking a call** — if you add a new provider origin, add it to the
  `connect-src` policy in `public/_headers`.