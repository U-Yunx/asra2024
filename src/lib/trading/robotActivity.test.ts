/**
 * Tests for the persisted robot activity feed + last-run timestamp — the
 * state that lets the Trading page keep showing what the robot has been doing
 * across refreshes, tab closes and background runs (previously the feed lived
 * only in React state and was wiped on every reload).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearActivity,
  loadActivityLog,
  loadLastRun,
  MAX_ACTIVITY,
  saveActivityLog,
  saveLastRun,
  type ActivityEntry,
} from './robotActivity'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  // vitest runs in a node environment — provide a minimal localStorage.
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

describe('robot activity feed persistence', () => {
  it('defaults to an empty feed when nothing has been saved', () => {
    expect(loadActivityLog()).toEqual([])
    expect(loadActivityLog('user-1')).toEqual([])
  })

  it('round-trips timestamped entries for anonymous visitors', () => {
    const entries: ActivityEntry[] = [
      { t: 1_700_000_000_000, m: 'Opened EUR/USD long at 1.1621.' },
      { t: 1_700_000_060_000, m: 'Closed EUR/USD long +$12.40.' },
    ]
    saveActivityLog(entries)
    expect(loadActivityLog()).toEqual(entries)
  })

  it('scopes the feed per signed-in user', () => {
    saveActivityLog([{ t: 1, m: 'user-1 activity' }], 'user-1')
    expect(loadActivityLog('user-1')).toHaveLength(1)
    expect(loadActivityLog()).toEqual([])
    expect(loadActivityLog('user-2')).toEqual([])
  })

  it('keeps only the most recent MAX_ACTIVITY entries (newest first)', () => {
    // The feed is always stored newest-first (pushLog prepends), so simulate
    // what the page writes: latest event at index 0.
    const many: ActivityEntry[] = Array.from({ length: MAX_ACTIVITY + 25 }, (_, i) => ({
      t: 1_000 + i,
      m: `entry ${i}`,
    })).reverse()
    saveActivityLog(many)
    const loaded = loadActivityLog()
    expect(loaded).toHaveLength(MAX_ACTIVITY)
    // The newest entries (highest timestamps) survive.
    expect(loaded[0].m).toBe(`entry ${MAX_ACTIVITY + 24}`)
  })

  it('treats malformed / garbage values as an empty feed', () => {
    store.set('ana24.robot-activity', 'not-json')
    expect(loadActivityLog()).toEqual([])
    store.set('ana24.robot-activity', JSON.stringify({ not: 'an array' }))
    expect(loadActivityLog()).toEqual([])
    store.set('ana24.robot-activity', JSON.stringify([{ t: 'oops', m: 42 }]))
    expect(loadActivityLog()).toEqual([])
  })
})

describe('last-run timestamp persistence', () => {
  it('defaults to null when nothing has been saved', () => {
    expect(loadLastRun()).toBeNull()
    expect(loadLastRun('user-1')).toBeNull()
  })

  it('round-trips the timestamp and scopes per user', () => {
    const at = Date.now() - 60_000
    saveLastRun(at, 'user-1')
    expect(loadLastRun('user-1')).toBe(at)
    expect(loadLastRun()).toBeNull()
    expect(loadLastRun('user-2')).toBeNull()
  })

  it('treats malformed values as unset', () => {
    saveLastRun(1234, 'user-1')
    const raw = new Map<string, string>([['ana24.robot-last-run:user-1', 'not-a-number']])
    ;(globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => raw.get(k) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    expect(loadLastRun('user-1')).toBeNull()
  })
})

describe('clearActivity', () => {
  it('forgets the feed and the last-run time for the requested scope only', () => {
    saveActivityLog([{ t: 1, m: 'x' }], 'user-1')
    saveLastRun(123, 'user-1')
    saveActivityLog([{ t: 2, m: 'y' }], 'user-2')
    saveLastRun(456, 'user-2')

    clearActivity('user-1')
    expect(loadActivityLog('user-1')).toEqual([])
    expect(loadLastRun('user-1')).toBeNull()
    // user-2's copy is untouched.
    expect(loadActivityLog('user-2')).toHaveLength(1)
    expect(loadLastRun('user-2')).toBe(456)
  })
})
