#!/usr/bin/env node
/**
 * Deploy ANA24 to a Cloudflare Pages project via the Cloudflare REST API.
 *
 * This replaces the old workflow that required a pre-linked Cloudflare account
 * (CLOUDFLARE_ACCOUNT_ID secret) and a Pages project that had to exist before
 * deploying. With this script you only need ONE secret:
 *
 *   CLOUDFLARE_API_TOKEN  — Cloudflare API token with "Cloudflare Pages: Edit"
 *                           permission, issued on the (fresh) account you want
 *                           to deploy to.
 *
 * The script:
 *   1. resolves the account from the token (no account binding in the repo),
 *   2. auto-creates the Pages project if it does not exist yet,
 *   3. uploads ./dist as a direct-upload deployment (by content hash),
 *   4. reports the deployment URL.
 *
 * It is used by .github/workflows/deploy-cloudflare.yml but can also be run
 * locally:  node scripts/deploy-cloudflare.mjs   (token via env)
 *
 * Requirements: Node >= 20 (global fetch, FormData, Blob, File, crypto).
 * Requires the app to be built first (npm run build → ./dist).
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const PROJECT_NAME = process.env.PAGES_PROJECT_NAME || 'ana24'
const PRODUCTION_BRANCH = process.env.PAGES_PRODUCTION_BRANCH || 'main'
const DIST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
)

// Files Pages manages out-of-band (sent as dedicated form fields, not assets).
const IGNORE = new Set(['_worker.js', '_redirects', '_headers', '_routes.json'])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const contentTypeFor = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class DeployError extends Error {}

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

async function api(route, { method = 'GET', token, body, headers = {}, retries = 2 } = {}) {
  const url = route.startsWith('http') ? route : `${API_BASE}${route}`
  const isForm = body instanceof FormData
  const init = {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ?? undefined,
  }

  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init)
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success === true) {
        return { status: res.status, result: json.result }
      }
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status} from Cloudflare (${route})`)
        await sleep(1000 * 2 ** attempt)
        continue
      }
      const detail = (json.errors || [])
        .map((e) => `${e.code}: ${e.message}`)
        .join('; ')
      throw new DeployError(`Cloudflare API ${method} ${route} failed (HTTP ${res.status}): ${detail || res.statusText}`)
    } catch (err) {
      if (err instanceof DeployError) throw err
      lastErr = err
      if (attempt < retries) await sleep(1000 * 2 ** attempt)
    }
  }
  throw new DeployError(`Request to ${route} failed after retries: ${lastErr?.message || 'unknown error'}`)
}

async function resolveAccount(token, explicitId) {
  if (explicitId) {
    console.log(`→ Using account ${explicitId} (CLOUDFLARE_ACCOUNT_ID override)`)
    return explicitId
  }
  // Prefer the /accounts list — API tokens report the account(s) they are scoped to.
  try {
    const { result } = await api('/accounts', { token })
    if (result.length === 1) {
      console.log(`→ Resolved account ${result[0].id} (${result[0].name || 'unnamed'}) from API token`)
      return result[0].id
    }
    if (result.length > 1) {
      const ids = result.map((a) => `  - ${a.id} (${a.name || 'unnamed'})`).join('\n')
      throw new DeployError(
        `Your API token has access to ${result.length} accounts. Deploying to a fresh\n` +
          `account must be unambiguous — set the CLOUDFLARE_ACCOUNT_ID env var to one of:\n${ids}`,
      )
    }
  } catch (err) {
    if (err instanceof DeployError && err.message.includes('access to')) throw err
    console.warn(`  (could not list /accounts: ${err.message})`)
  }
  // Fallback for tokens that cannot list accounts directly.
  try {
    const { result } = await api('/memberships', { token })
    const accounts = result.filter((m) => m.status === 'active').map((m) => m.account)
    if (accounts.length === 1) {
      console.log(`→ Resolved account ${accounts[0].id} (${accounts[0].name || 'unnamed'}) via /memberships`)
      return accounts[0].id
    }
    if (accounts.length > 1) {
      const ids = accounts.map((a) => `  - ${a.id} (${a.name || 'unnamed'})`).join('\n')
      throw new DeployError(
        `Your token is linked to ${accounts.length} accounts. Set CLOUDFLARE_ACCOUNT_ID to one of:\n${ids}`,
      )
    }
  } catch (err) {
    if (err instanceof DeployError && err.message.includes('linked to')) throw err
    console.warn(`  (could not list /memberships: ${err.message})`)
  }
  throw new DeployError(
    'Could not determine your Cloudflare account from the API token. Make sure the\n' +
      'token has "Cloudflare Pages: Edit" permission scoped to your account, or set\n' +
      'CLOUDFLARE_ACCOUNT_ID explicitly.',
  )
}

async function ensureProject(accountId, token) {
  const base = `/accounts/${accountId}/pages/projects/${PROJECT_NAME}`
  try {
    const { result } = await api(base, { token })
    console.log(`→ Pages project "${PROJECT_NAME}" exists (production branch: ${result.production_branch})`)
    return result
  } catch (err) {
    if (!(err instanceof DeployError) || !/failed \(HTTP 404\)/.test(err.message)) throw err
  }
  // 404 — create the project on the fresh account automatically.
  const { result } = await api(`/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    token,
    body: JSON.stringify({ name: PROJECT_NAME, production_branch: PRODUCTION_BRANCH }),
  })
  console.log(`→ Created Pages project "${PROJECT_NAME}" on this account (production branch: ${PRODUCTION_BRANCH})`)
  return result
}

async function collectFiles() {
  const files = []
  const walk = async (dir) => {
    const entries = await readdir(dir)
    for (const entry of entries) {
      const abs = path.join(dir, entry)
      const rel = path.relative(DIST_DIR, abs).split(path.sep).join('/')
      if (IGNORE.has(rel)) continue
      const st = await stat(abs)
      if (st.isDirectory()) {
        await walk(abs)
      } else if (st.isFile()) {
        files.push({ rel, abs, size: st.size, contentType: contentTypeFor(rel) })
      }
    }
  }
  await walk(DIST_DIR)
  return files
}

async function uploadAssets(accountId, projectName, token, files) {
  const { result } = await api(`/accounts/${accountId}/pages/projects/${projectName}/upload-token`, {
    token,
  })
  const jwt = result.jwt
  if (!jwt) throw new DeployError('Cloudflare did not return an upload token.')

  const hashes = files.map((f) => f.hash)
  const missingRes = await api('/pages/assets/check-missing', {
    method: 'POST',
    token: jwt,
    body: JSON.stringify({ hashes }),
  })
  const missing = new Set(missingRes.result || [])
  const toUpload = files.filter((f) => missing.has(f.hash))
  console.log(`→ ${files.length} asset(s) in bundle, ${toUpload.length} new, ${files.length - toUpload.length} cached`)

  // Upload missing assets in batches, keyed by content hash.
  const BATCH = 100
  for (let i = 0; i < toUpload.length; i += BATCH) {
    const batch = toUpload.slice(i, i + BATCH)
    const payload = await Promise.all(
      batch.map(async (f) => ({
        key: f.hash,
        value: (await readFile(f.abs)).toString('base64'),
        metadata: { contentType: f.contentType },
        base64: true,
      })),
    )
    await api('/pages/assets/upload', {
      method: 'POST',
      token: jwt,
      body: JSON.stringify(payload),
    })
    console.log(`  uploaded ${Math.min(i + BATCH, toUpload.length)}/${toUpload.length}`)
  }

  // Remember hashes so future deploys can skip unchanged files.
  try {
    await api('/pages/assets/upsert-hashes', {
      method: 'POST',
      token: jwt,
      body: JSON.stringify({ hashes }),
    })
  } catch (err) {
    console.warn(`  (note: hash index not updated — ${err.message})`)
  }

  return jwt
}

async function createDeployment(accountId, projectName, token, manifest, branch) {
  const form = new FormData()
  form.append('manifest', JSON.stringify(manifest))
  form.append('branch', branch)
  form.append('commit_dirty', 'false')
  if (process.env.GITHUB_SHA) form.append('commit_hash', process.env.GITHUB_SHA)
  if (process.env.GITHUB_COMMIT_MESSAGE) form.append('commit_message', process.env.GITHUB_COMMIT_MESSAGE)

  for (const name of ['_headers', '_redirects']) {
    const abs = path.join(DIST_DIR, name)
    try {
      const content = await readFile(abs, 'utf8')
      form.append(name, new File([content], name))
      console.log(`→ Attaching ${name} to deployment`)
    } catch {
      // optional files
    }
  }

  const { result } = await api(`/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
    method: 'POST',
    token,
    body: form,
    retries: 3,
  })
  return result
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const token = process.env.CLOUDFLARE_API_TOKEN

  const branch =
    process.env.GITHUB_REF_NAME ||
    process.env.CF_PAGES_BRANCH ||
    process.env.BRANCH ||
    PRODUCTION_BRANCH

  console.log(`\nDeploying "${PROJECT_NAME}" (branch: ${branch}) from ${DIST_DIR}\n`)

  // Build the asset list and manifest first — this is local-only, so it also
  // powers the fully offline --dry-run mode.
  const files = await collectFiles()
  if (files.length === 0) {
    fail(`No files found in ${DIST_DIR}. Run "npm run build" first.`)
  }

  const manifest = {}
  for (const f of files) {
    const content = await readFile(f.abs)
    f.hash = createHash('sha256').update(content).digest('hex')
    manifest[`/${f.rel}`] = f.hash
  }

  if (dryRun) {
    console.log(`DRY RUN — no network calls made. ${files.length} asset(s) would be uploaded:`)
    for (const f of files.slice(0, 20)) console.log(`  /${f.rel}  (${f.contentType})`)
    if (files.length > 20) console.log(`  … and ${files.length - 20} more`)
    console.log(`\nManifest preview:\n${JSON.stringify(manifest, null, 2).slice(0, 1200)}`)
    return
  }

  if (!token) {
    fail(
      'CLOUDFLARE_API_TOKEN is not set. Create a Cloudflare API token with\n' +
        '  "Cloudflare Pages: Edit" permission on the account you want to deploy to,\n' +
        '  then export it:  export CLOUDFLARE_API_TOKEN=...',
    )
  }

  const accountId = await resolveAccount(token, process.env.CLOUDFLARE_ACCOUNT_ID)
  const project = await ensureProject(accountId, token)

  await uploadAssets(accountId, PROJECT_NAME, token, files)

  const env = branch === (project.production_branch || PRODUCTION_BRANCH) ? 'production' : 'preview'
  const deployment = await createDeployment(accountId, PROJECT_NAME, token, manifest, branch)

  console.log(`\n✅ Deployed (${env})`)
  console.log(`   Deployment ID : ${deployment.id}`)
  console.log(`   Live URL      : ${deployment.url}`)
  console.log(`   Alias URL     : ${deployment.aliases?.find((a) => !a.includes('.pages.dev')) || deployment.url}`)
  if (process.env.GITHUB_ACTIONS) console.log(`   (environment: ${env})`)
}

main().catch((err) => {
  if (err instanceof DeployError) {
    fail(err.message)
  }
  console.error('\n✖ Unexpected error:', err)
  process.exit(1)
})
