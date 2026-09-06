/**
 * Tests for robot running-state persistence — the on/off flag that survives
 * refreshes and tab closes in every trading mode. Live OANDA / MetaTrader
 * mirrors are never persisted, so this flag is their only record of whether
 * the robot was running.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { clearRobotRunning, loadRobotRunning, saveRobotRunning } from './robotState'

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
