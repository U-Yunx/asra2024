#!/usr/bin/env node
/**
 * Pre-deploy environment check for ANA24.
 *
 * Verifies that the variables the browser bundle needs at runtime are present
 * in the environment. This runs from `npm run predeploy` (wired in package.json
 * before the Cloudflare deploy step). It exits non-zero if anything required is
 * missing so a broken deploy never ships.
 *
 * The two VITE_* values are PUBLIC (URL + publishable/anon key) — they are safe
 * to bake into the static bundle. No real secrets belong here.
 */
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

const missing = required.filter((key) => !process.env[key])

if (missing.length > 0) {
  console.error('[check-deploy-env] Missing required environment variables:')
  for (const key of missing) {
    console.error(`  - ${key}`)
  }
  console.error(
    '\nSet them in the platform Environment settings (Preview/Production) or a local .env.local, then retry.',
  )
  process.exit(1)
}

console.log('[check-deploy-env] All required variables present. Proceeding to deploy.')
process.exit(0)