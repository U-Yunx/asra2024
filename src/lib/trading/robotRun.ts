/**
 * Client ↔ server robot-run sync.
 *
 * While the robot runs on a ledger-backed account (paper / managed live), the
 * browser mirrors the run's full configuration into the `robot_runs` table and
 * heartbeats `client_heartbeat_at` so the scheduled `robot-runner` Edge
 * Function knows this page is alive. When the page closes or refreshes the
 * heartbeat goes stale and the server takes over — trading continues in the
 * background with the same engine rules, duration, session limits and access
 * gating. On reload the page reconciles: it resumes the countdown / session
 * baseline from the server row, or stops cleanly if the background run already
 * finished (duration elapsed / session guard hit / access lost).
 *
 * Live OANDA / MetaTrader mirrors are never mirrored — their authoritative
 * state lives at the broker and their robot keeps running in the browser only.
 */
import { isSupabaseConfigured, supabase } from '../supabase'
import type { RobotPrefs, StrategyType, TradingMethod } from '../types'

export type RobotRunStatus = 'running' | 'stopped' | 'finished'

export interface RobotRunRow {
  id: string
  user_id: string
  account_id: string
  status: RobotRunStatus
  method: TradingMethod
  strategy_mode: 'auto' | 'manual'
  manual_strategy: StrategyType | null
  pairs: string[]
  auto_pick_pairs: boolean
  pair_count: number
  trade_mode: 'sequential' | 'concurrent'
  max_per_pair: number
  max_open_trades: number
  per_trade_take_profit_pips: number
  per_trade_stop_loss_pips: number
  overall_max_profit_usd: number
  overall_max_loss_usd: number
  size_multiplier: number
  duration_minutes: number | null
  ends_at: string | null
  session_start_equity: number | null
  client_heartbeat_at: string | null
  last_tick_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface RobotRunSyncInput {
  prefs: RobotPrefs
  /** The pairs the robot is actually scanning (selected, or auto-picked). */
  pairs: string[]
  /** Auto-run window end (epoch ms), or null for "run until stopped". */
  endsAt: number | null
  /** Equity when the run started (session guard baseline), or null. */
  sessionStartEquity: number | null
  /** Manual-tune position-size multiplier (1 when untouched). */
  sizeMultiplier: number
}

/** Load the current run row for the account (null when none exists). */
export async function loadRobotRun(userId: string, accountId: string): Promise<RobotRunRow | null> {
  if (!isSupabaseConfigured || !userId || !accountId) return null
  try {
    const { data } = await supabase
      .from('robot_runs')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle()
    return (data as RobotRunRow) ?? null
  } catch {
    return null
  }
}

/**
 * Mirror (upsert) the running robot's config to the server so the background
 * runner can take over when this page closes. Safe to call repeatedly — it
 * replaces the whole row.
 */
export async function saveRobotRun(userId: string, accountId: string, input: RobotRunSyncInput): Promise<void> {
  if (!isSupabaseConfigured || !userId || !accountId) return
  const now = new Date().toISOString()
  const row = {
    user_id: userId,
    account_id: accountId,
    status: 'running' as const,
    method: input.prefs.method,
    strategy_mode: input.prefs.strategyMode,
    manual_strategy: input.prefs.strategyMode === 'manual' ? input.prefs.manualStrategy : null,
    pairs: input.pairs,
    auto_pick_pairs: input.prefs.autoPickPairs,
    pair_count: input.prefs.pairCount,
    trade_mode: input.prefs.tradeMode,
    max_per_pair: input.prefs.maxPerPair,
    max_open_trades: input.prefs.maxOpenTrades,
    per_trade_take_profit_pips: input.prefs.perTradeTakeProfitPips,
    per_trade_stop_loss_pips: input.prefs.perTradeStopLossPips,
    overall_max_profit_usd: input.prefs.overallMaxProfitUsd,
    overall_max_loss_usd: input.prefs.overallMaxLossUsd,
    size_multiplier: input.sizeMultiplier || 1,
    duration_minutes: input.prefs.durationMinutes,
    ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    session_start_equity: input.sessionStartEquity,
    client_heartbeat_at: now,
    last_error: null,
    updated_at: now,
  }
  try {
    await supabase.from('robot_runs').upsert(row, { onConflict: 'user_id,account_id' })
  } catch {
    /* best-effort — the browser loop keeps trading regardless */
  }
}

/** Tell the server the robot has been stopped / the run ended. */
export async function stopRobotRun(userId: string, accountId: string): Promise<void> {
  if (!isSupabaseConfigured || !userId || !accountId) return
  try {
    await supabase
      .from('robot_runs')
      .update({ status: 'stopped', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('account_id', accountId)
  } catch {
    /* best-effort */
  }
}

const HEARTBEAT_MIN_MS = 20_000
const lastHeartbeat: { key: string; at: number } = { key: '', at: 0 }

/**
 * Refresh the client heartbeat (throttled). While the page is open this tells
 * the background runner to stand down; when it stops the server takes over.
 */
export async function heartbeatRobotRun(userId: string, accountId: string): Promise<void> {
  if (!isSupabaseConfigured || !userId || !accountId) return
  const key = `${userId}:${accountId}`
  const now = Date.now()
  if (lastHeartbeat.key === key && now - lastHeartbeat.at < HEARTBEAT_MIN_MS) return
  lastHeartbeat.key = key
  lastHeartbeat.at = now
  try {
    await supabase
      .from('robot_runs')
      .update({ client_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('account_id', accountId)
  } catch {
    /* best-effort */
  }
}
