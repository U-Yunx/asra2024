# Deploying ANA24 to Cloudflare Pages

ANA24 deploys as a static SPA to Cloudflare Pages. All server-side work runs in
Supabase Edge Functions, so the Pages site itself is just the built bundle.

## How deployment works

Deployment is **CI-only** via GitHub Actions (`.github/workflows/deploy-cloudflare.yml`):

```
push to main  →  npm ci → npm test → npm run deploy (env guard + corruption guard + build)
              →  wrangler-action pages deploy ./dist --project-name ana24
```

- `npm run deploy` locally = `predeploy` (env guard + corruption guard) + `build`.
  It does **not** push to Pages — the Pages upload happens in CI.
- `wrangler` is **not** a project devDependency. CI uses
  `cloudflare/wrangler-action@v4`, which brings its own wrangler. You don't need
  to install wrangler locally.
- `scripts/check-deploy-env.mjs` (runs inside `predeploy`) exits non-zero if a
  required build variable is missing, so a broken deploy never ships.

## Prerequisites (one-time, done by the app owner)

1. **Cloudflare account** with a Pages project named `ana24` created
   (Cloudflare dashboard → Workers & Pages → Create → Pages → project name `ana24`).
2. **Cloudflare API token** with the **Cloudflare Pages: Edit** permission
   (dash.cloudflare.com → My Profile → API Tokens → Create Token → custom token,
   scoped to your account with `Cloudflare Pages — Edit`).
   Copy the **account ID** too — it's in the dashboard URL:
   `https://dash.cloudflare.com/<ACCOUNT_ID>`.
3. **GitHub repo** for this project (connect GitHub in native.builder
   Settings → Integrations, then use the **Sync** button on the project).

## Activating CI (one-time, done by the app owner)

Add to the GitHub repo: **Settings → Secrets and variables → Actions**.

| Scope | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Cloudflare Pages: Edit** permission |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (from the dash URL) |
| Secret or variable | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` — public |
| Secret or variable | `VITE_SUPABASE_ANON_KEY` | Publishable/anon key — public |

The Cloudflare token is a real secret and only ever exists in GitHub secrets /
Cloudflare; it is never baked into the bundle. The two `VITE_*` values are
**public** (URL + publishable/anon key) — they are baked into the static bundle
at build time, which is safe.

After the secrets are in place, push to `main` (or run the workflow manually via
the **Actions** tab → *Deploy to Cloudflare Pages* → *Run workflow*). The site
appears at `https://ana24.pages.dev` (or your custom domain).

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
- **CI fails at "Verify deploy env"** — one of the four repo secrets/variables
  above is missing from GitHub Settings → Secrets and variables → Actions.
- **CI fails at the Pages step** — the Cloudflare token lacks `Cloudflare Pages:
  Edit`, or the Pages project `ana24` hasn't been created yet.
- **CSP blocking a call** — if you add a new provider origin, add it to the
  `connect-src` policy in `public/_headers`.
