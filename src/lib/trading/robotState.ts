/**
 * Robot running-state persistence.
 *
 * The robot's on/off flag lives on the account's `risk.autoTrade`, which paper
 * and managed-live accounts persist in full. Live OANDA / MetaTrader mirrors
 * are intentionally never saved — their authoritative state is re-fetched from
 * the broker on every load — so the on/off flag is mirrored here. On a refresh
 * (or returning after closing the tab) the flag is re-applied to the loaded
 * account, so a robot that was running keeps running and a stopped one stays
 * stopped, in every mode. The key is scoped per signed-in user; anonymous
 * visitors share the unscoped key (their account lives in localStorage anyway).
 *
 * Two companions make a run survive a reload faithfully:
 *   - the auto-run end time, so the countdown resumes where it left off (and a
 *     run whose window elapsed while the tab was closed stops cleanly instead
 *     of trading past its schedule), and
 *   - the session-start equity, so the max-profit / max-loss guard keeps
 *     measuring from where the run began, not from where you returned.
 */

const KEY_PREFIX = 'ana24.robot-running'
const RUN_END_PREFIX = 'ana24.robot-run-end'
const SESSION_START_PREFIX = 'ana24.robot-session-start'

function scoped(prefix: string, userId?: string | null): string {
  return userId ? `${prefix}:${userId}` : prefix
}

/** True when the robot was running the last time the app closed. */
export function loadRobotRunning(userId?: string | null): boolean {
  try {
    return localStorage.getItem(scoped(KEY_PREFIX, userId)) === '1'
  } catch {
    return false
  }
}

/** Record whether the robot is currently running (called on every start/stop). */
export function saveRobotRunning(running: boolean, userId?: string | null): void {
  try {
    localStorage.setItem(scoped(KEY_PREFIX, userId), running ? '1' : '0')
  } catch {
    /* storage full / blocked — non-fatal */
  }
}

/** Forget the persisted robot state (used when an account is reset). */
export function clearRobotRunning(userId?: string | null): void {
  try {
    localStorage.removeItem(scoped(KEY_PREFIX, userId))
  } catch {
    /* noop */
  }
}

/** When the current auto-run window ends (epoch ms), or null when unset. */
export function loadRunEnd(userId?: string | null): number | null {
  try {
    const raw = localStorage.getItem(scoped(RUN_END_PREFIX, userId))
    if (raw == null) return null
    const t = Number(raw)
    return Number.isFinite(t) && t > 0 ? t : null
  } catch {
    return null
  }
}

/** Persist the auto-run end time (epoch ms), or remove it when null. */
export function saveRunEnd(endsAt: number | null, userId?: string | null): void {
  try {
    const key = scoped(RUN_END_PREFIX, userId)
    if (endsAt == null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(endsAt))
  } catch {
    /* noop */
  }
}

/** Forget a persisted auto-run end time. */
export function clearRunEnd(userId?: string | null): void {
  saveRunEnd(null, userId)
}

/** Equity captured when the current run started (USD), or null when unset. */
export function loadSessionStart(userId?: string | null): number | null {
  try {
    const raw = localStorage.getItem(scoped(SESSION_START_PREFIX, userId))
    if (raw == null) return null
    const v = Number(raw)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Persist the session-start equity, or remove it when null. */
export function saveSessionStart(equityUsd: number | null, userId?: string | null): void {
  try {
    const key = scoped(SESSION_START_PREFIX, userId)
    if (equityUsd == null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(equityUsd))
  } catch {
    /* noop */
  }
}

/** Forget a persisted session-start equity. */
export function clearSessionStart(userId?: string | null): void {
  saveSessionStart(null, userId)
}
