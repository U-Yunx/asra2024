/**
 * Persisted robot activity feed + last-run timestamp.
 *
 * The robot's live activity feed and "last run" time used to live only in
 * React state, so a refresh (or returning after closing the tab) wiped them:
 * the feed came back empty and the page showed "Waiting for a signal…" even
 * when the robot had just been trading. The feed is now mirrored to
 * localStorage (scoped per signed-in user, shared for anonymous visitors) on
 * every update and restored on load, so the page always shows what the robot
 * has been doing recently — across refreshes, tab closes and background runs.
 */

export interface ActivityEntry {
  /** Epoch ms when the event happened. */
  t: number
  /** Human-readable event message. */
  m: string
}

const KEY_PREFIX = 'ana24.robot-activity'
const LAST_RUN_PREFIX = 'ana24.robot-last-run'
/** How many recent entries the feed keeps (persisted + displayed). */
export const MAX_ACTIVITY = 30

function scoped(prefix: string, userId?: string | null): string {
  return userId ? `${prefix}:${userId}` : prefix
}

/** Load the persisted activity feed (newest first). */
export function loadActivityLog(userId?: string | null): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(scoped(KEY_PREFIX, userId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is ActivityEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as ActivityEntry).m === 'string' &&
          typeof (e as ActivityEntry).t === 'number',
      )
      .slice(0, MAX_ACTIVITY)
  } catch {
    return []
  }
}

/** Persist the activity feed (newest first). Safe to call on every update. */
export function saveActivityLog(entries: ActivityEntry[], userId?: string | null): void {
  try {
    localStorage.setItem(scoped(KEY_PREFIX, userId), JSON.stringify(entries.slice(0, MAX_ACTIVITY)))
  } catch {
    /* storage full / blocked — non-fatal */
  }
}

/** When the robot last ran a successful cycle (epoch ms), or null. */
export function loadLastRun(userId?: string | null): number | null {
  try {
    const raw = localStorage.getItem(scoped(LAST_RUN_PREFIX, userId))
    if (raw == null) return null
    const t = Number(raw)
    return Number.isFinite(t) && t > 0 ? t : null
  } catch {
    return null
  }
}

/** Record when the robot last ran a successful cycle. */
export function saveLastRun(at: number, userId?: string | null): void {
  try {
    localStorage.setItem(scoped(LAST_RUN_PREFIX, userId), String(at))
  } catch {
    /* noop */
  }
}

/** Forget the persisted feed + last-run time (used when an account resets). */
export function clearActivity(userId?: string | null): void {
  try {
    localStorage.removeItem(scoped(KEY_PREFIX, userId))
    localStorage.removeItem(scoped(LAST_RUN_PREFIX, userId))
  } catch {
    /* noop */
  }
}
