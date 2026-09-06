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
 */
const KEY_PREFIX = 'ana24.robot-running'

function key(userId?: string | null): string {
  return userId ? `${KEY_PREFIX}:${userId}` : KEY_PREFIX
}

/** True when the robot was running the last time the app closed. */
export function loadRobotRunning(userId?: string | null): boolean {
  try {
    return localStorage.getItem(key(userId)) === '1'
  } catch {
    return false
  }
}

/** Record whether the robot is currently running (called on every start/stop). */
export function saveRobotRunning(running: boolean, userId?: string | null): void {
  try {
    localStorage.setItem(key(userId), running ? '1' : '0')
  } catch {
    /* storage full / blocked — non-fatal */
  }
}

/** Forget the persisted robot state (used when an account is reset). */
export function clearRobotRunning(userId?: string | null): void {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    /* noop */
  }
}
