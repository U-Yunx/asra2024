/**
 * Robot session + equity history — powers the Performance page. Sessions are
 * written by `useRobotRecorder` while the robot runs; this module reads them.
 */
import { isSupabaseConfigured, supabase } from '../supabase'

export interface RobotSessionRow {
  id: string
  user_id: string
  account_id: string | null
  method: string | null
  strategy: string | null
  started_at: string
  ended_at: string | null
  status: 'running' | 'finished'
  initial_balance: number
  final_balance: number | null
  pnl: number | null
  trade_count: number
}

export interface RobotHistoryPoint {
  id: string
  session_id: string | null
  recorded_at: string
  balance: number
  equity: number
  unrealized: number
}

export interface RobotPerformance {
  sessions: RobotSessionRow[]
  history: RobotHistoryPoint[]
}

export async function loadRobotHistory(userId: string): Promise<RobotPerformance> {
  if (!isSupabaseConfigured) return { sessions: [], history: [] }
  try {
    const [sRes, hRes] = await Promise.all([
      supabase
        .from('robot_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(200),
      supabase
        .from('robot_history')
        .select('*')
        .eq('user_id', userId)
        .order('recorded_at', { ascending: true })
        .limit(2000),
    ])
    return {
      sessions: (sRes.data ?? []) as RobotSessionRow[],
      history: (hRes.data ?? []) as RobotHistoryPoint[],
    }
  } catch {
    return { sessions: [], history: [] }
  }
}

/** Latest robot session for a user (or null). */
export async function latestRobotSession(userId: string): Promise<RobotSessionRow | null> {
  if (!isSupabaseConfigured) return null
  const { data } = await supabase
    .from('robot_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as RobotSessionRow | null) ?? null
}