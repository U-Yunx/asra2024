/**
 * Tests for robot running-state persistence — the on/off flag that survives
 * refreshes and tab closes in every trading mode. Live OANDA / MetaTrader
 * mirrors are never persisted, so this flag is their only record of whether
 * the robot was running. The auto-run end time and session-start equity are
 * companions that let a run resume faithfully (countdown where it left off,
 * guard baseline from where the run began).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRobotRunning,
  clearRunEnd,
  clearSessionStart,
  loadRobotRunning,
  loadRunEnd,
  loadSessionStart,
  saveRobotRunning,
  saveRunEnd,
  saveSessionStart,
} from './robotState'

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

describe('robot running-state persistence', () => {
  it('defaults to off when nothing has been saved', () => {
    expect(loadRobotRunning()).toBe(false)
    expect(loadRobotRunning('user-1')).toBe(false)
  })

  it('round-trips on and off for anonymous visitors', () => {
    saveRobotRunning(true)
    expect(loadRobotRunning()).toBe(true)
    saveRobotRunning(false)
    expect(loadRobotRunning()).toBe(false)
  })

  it('scopes the flag per signed-in user', () => {
    saveRobotRunning(true, 'user-1')
    expect(loadRobotRunning('user-1')).toBe(true)
    expect(loadRobotRunning()).toBe(false)
    expect(loadRobotRunning('user-2')).toBe(false)
  })

  it('clearRobotRunning forgets only the requested scope', () => {
    saveRobotRunning(true, 'user-1')
    saveRobotRunning(true, 'user-2')
    clearRobotRunning('user-1')
    expect(loadRobotRunning('user-1')).toBe(false)
    expect(loadRobotRunning('user-2')).toBe(true)
  })
})

describe('auto-run end time persistence', () => {
  it('defaults to null when nothing has been saved', () => {
    expect(loadRunEnd()).toBeNull()
    expect(loadRunEnd('user-1')).toBeNull()
  })

  it('round-trips an end time and clears it', () => {
    const end = Date.now() + 30 * 60_000
    saveRunEnd(end, 'user-1')
    expect(loadRunEnd('user-1')).toBe(end)
    saveRunEnd(null, 'user-1')
    expect(loadRunEnd('user-1')).toBeNull()
    expect(clearRunEnd('user-1')).toBeUndefined()
  })

  it('scopes the end time per signed-in user', () => {
    saveRunEnd(1_000_000, 'user-1')
    expect(loadRunEnd('user-1')).toBe(1_000_000)
    expect(loadRunEnd()).toBeNull()
    expect(loadRunEnd('user-2')).toBeNull()
  })

  it('treats malformed values as unset', () => {
    saveRunEnd(1234, 'user-1')
    const raw = new Map<string, string>([
      ['ana24.robot-run-end:user-1', 'not-a-number'],
    ])
    ;(globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => raw.get(k) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    expect(loadRunEnd('user-1')).toBeNull()
  })
})

describe('session-start equity persistence', () => {
  it('defaults to null when nothing has been saved', () => {
    expect(loadSessionStart()).toBeNull()
    expect(loadSessionStart('user-1')).toBeNull()
  })

  it('round-trips the equity baseline and clears it', () => {
    saveSessionStart(9_842.5, 'user-1')
    expect(loadSessionStart('user-1')).toBe(9_842.5)
    clearSessionStart('user-1')
    expect(loadSessionStart('user-1')).toBeNull()
  })

  it('scopes the baseline per signed-in user', () => {
    saveSessionStart(10_000, 'user-1')
    expect(loadSessionStart('user-1')).toBe(10_000)
    expect(loadSessionStart()).toBeNull()
    expect(loadSessionStart('user-2')).toBeNull()
  })
})
