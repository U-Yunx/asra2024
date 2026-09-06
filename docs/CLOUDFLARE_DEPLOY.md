# Deploying ANA24 to Cloudflare Pages

ANA24 deploys as a static SPA to Cloudflare Pages. All server-side work runs in
Supabase Edge Functions, so the Pages site itself is just the built bundle.

## How deployment works

Deployment is **CI-only** via GitHub Actions
(`.github/workflows/deploy-cloudflare.yml`), and it talks to **Cloudflare's REST
API directly** — no wrangler, no pre-linked account:

```
push to main  →  npm ci → npm test → npm run deploy (env guard + corruption guard + build)
              →  node scripts/deploy-cloudflare.mjs
```

`scripts/deploy-cloudflare.mjs`:

1. Resolves your Cloudflare **account from the API token** (`GET /accounts`) —
   nothing in the repo binds a specific account.
2. **Auto-creates** the Pages project `ana24` on the first deploy if it doesn't
   exist yet (fresh account: zero dashboard setup).
3. Uploads `dist/` as a direct-upload deployment keyed by content hash
   (`/pages/assets/check-missing` → `/pages/assets/upload` →
   `/pages/assets/upsert-hashes`), including `_redirects` and `_headers`.
4. Creates the deployment (`POST .../pages/projects/ana24/deployments`) and
   prints the live URL.

You can also run the same script locally:

```bash
CLOUDFLARE_API_TOKEN=... npm run build
CLOUDFLARE_API_TOKEN=... node scripts/deploy-cloudflare.mjs
```

## Prerequisites (one-time, done by the app owner)

1. **A Cloudflare account** — if you are moving to a **fresh** account, just
   create it; the Pages project is created automatically on first deploy.
2. **Cloudflare API token** with the **Cloudflare Pages: Edit** permission
   (dash.cloudflare.com → My Profile → API Tokens → Create Token → custom token,
   scoped to the account you want to deploy to).
3. **GitHub repo** for this project (connect GitHub in native.builder
   Settings → Integrations, then use the **Sync** button on the project).

That's it — there is **no** `CLOUDFLARE_ACCOUNT_ID` to collect anymore. The
account is derived from the token.

## Activating CI (one-time, done by the app owner)

Add to the GitHub repo: **Settings → Secrets and variables → Actions**.

| Scope | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Cloudflare Pages: Edit** permission |
| Secret or variable | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` — public |
| Secret or variable | `VITE_SUPABASE_ANON_KEY` | Publishable/anon key — public |

**Moving away from an old/linked account:** delete the old `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` secrets, then add the new token issued on the fresh
account. The old `CLOUDFLARE_ACCOUNT_ID` secret is no longer read by anything —
you can remove it.

The Cloudflare token is a real secret and only ever exists in GitHub secrets /
Cloudflare; it is never baked into the bundle. The two `VITE_*` values are
**public** (URL + publishable/anon key) — they are baked into the static bundle
at build time, which is safe.

After the secrets are in place, push to `main` (or run the workflow manually via
the **Actions** tab → *Deploy to Cloudflare Pages* → *Run workflow*). The site
appears at `https://ana24.pages.dev` (or your custom domain).

> One token with access to **multiple** accounts? The script refuses to guess —
> set `CLOUDFLARE_ACCOUNT_ID` (as a repo variable, not a secret) to pick the
> account. With a single-account token (the normal case) it deploys with no
> further config.

## Routing

`public/_redirects` serves `/index.html` for every path (SPA fallback) so
client-side routes like `/trading`, `/admin` and `/profile` work on refresh.
The deploy script attaches `_redirects` and `_headers` from `dist/` to every
deployment automatically.

## Headers

`public/_headers` hardens the site (CSP, HSTS, frame/clickjack protection,
permissions policy). If you change the Supabase project ref, update the
`connect-src` entries there too.

## Troubleshooting

- **Blank page on refresh** — make sure `_redirects` is present in `dist/`.
- **Supabase calls failing in prod but not locally** — confirm
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set for the Production
  environment (not just Preview).
- **CI fails at "Verify deploy env"** — one of the required variables above is
  missing from GitHub Settings → Secrets and variables → Actions.
- **CI fails at the Pages step with "Could not determine your Cloudflare
  account"** — the token lacks the Pages: Edit permission or isn't scoped to an
  account; re-create it scoped to the intended (fresh) account.
- **CI fails at the Pages step with "access to N accounts"** — set the
  `CLOUDFLARE_ACCOUNT_ID` repo variable to the account you want.
- **CSP blocking a call** — if you add a new provider origin, add it to the
  `connect-src` policy in `public/_headers`.
