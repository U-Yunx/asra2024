#!/usr/bin/env node
/**
 * Smoke test for the trading engine.
 *
 * Runs the engine unit tests (vitest) — the same suite CI runs — and fails the
 * script if anything breaks, so it can be wired into predeploy/CI for a quick
 * "is the trading core still sound?" gate.
 *
 * Usage: node scripts/smoke-trading.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targets = ['src/lib/trading/engine.test.ts', 'src/lib/trading/robotStop.test.ts', 'src/lib/trading/multiTrade.test.ts']

console.log('🧪 Smoke: trading engine tests')
const res = spawnSync('npx', ['vitest', 'run', ...targets], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (res.status === 0) {
  console.log('✅ Smoke OK — trading engine is healthy.')
  process.exit(0)
}
console.error('❌ Smoke FAILED — trading engine tests did not pass.')
process.exit(res.status ?? 1)
