#!/usr/bin/env node
/**
 * ANA24 — Source-tree corruption guard.
 *
 * Scans the source tree for stray binary bytes (the signature of the
 * 30-byte binary-blob corruption that previously broke production builds
 * of this project). Exits non-zero with a clear report if any file is
 * corrupted, so a bad file can never ship silently again.
 *
 * Usage:  node scripts/check-corruption.mjs
 * Wired:  npm run predeploy (runs in CI before the production build)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)

// Files to scan — the full source tree plus the root configs that
// previously carried the corruption.
const SCAN_PATHS = ['src', 'supabase', 'scripts', 'public', 'index.html', 'vite.config.ts', 'vite-env.d.ts', 'tsconfig.json', 'package.json', 'wrangler.toml']

// Files we intentionally skip (binary assets, lockfiles, images, etc.)
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.svg', '.lock'])

const SKIP_FILE = new Set(['package-lock.json'])

// Control characters that are never legitimate in a text source file.
// Tab (0x09), LF (0x0a) and CR (0x0d) are allowed.
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
      walk(full, out)
    } else {
      out.push(full)
    }
  }
}

function isSkipped(file) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  return SKIP_EXT.has(ext) || SKIP_FILE.has(file)
}

const files = []
for (const p of SCAN_PATHS) {
  const full = join(ROOT, p)
  try {
    if (statSync(full).isDirectory()) walk(full, files)
    else files.push(full)
  } catch {
    // path missing — not a corruption issue
  }
}

const corrupted = []

for (const file of files) {
  if (isSkipped(file)) continue
  const buf = readFileSync(file)
  const text = buf.toString('utf8')
  // Invalid UTF-8 shows up as U+FFFD replacement characters.
  if (text.includes('\uFFFD')) {
    corrupted.push(`${relative(ROOT, file)} — invalid UTF-8`)
    continue
  }
  if (CONTROL_RE.test(text)) {
    corrupted.push(`${relative(ROOT, file)} — stray binary/control bytes`)
  }
}

if (corrupted.length > 0) {
  console.error('✗ CORRUPTION DETECTED — refusing to ship:')
  for (const c of corrupted) console.error(`  - ${c}`)
  process.exit(1)
}

console.log(`✓ Clean — scanned ${files.length} files, no corruption.`)