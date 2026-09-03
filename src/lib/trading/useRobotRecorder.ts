/**
 * Records robot runs as sessions + equity history so users can review past
 * performance (Performance page) and admins can see robot usage. Defensive:
 * silently no-ops for anonymous visitors and when Supabase is unavailable.
 */
import { useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AccountState, RatesMap } from './types'
import { equity } from './engine'
import { isSupabaseConfigured, supabase } from '../supabase'

interface UseRobotRecorderOptions {
  user: User | null
  account: AccountState | null
  running: boolean
  strategyLabel: string
  method: 'scalping' | 'longterm'
  rates: RatesMap
}

export function useRobotRecorder(opts: UseRobotRecorderOptions) {
  const { user, account, running, strategyLabel, method, rates } = opts
  const sessionIdRef = useRef<string | null>(null)
  const lastWriteRef = useRef<number>(0)
  const accountIdRef = useRef<string | null>(null)

  // Open a session when the robot starts.
  useEffect(() => {
    if (!user || !running || !account) return
    if (sessionIdRef.current) return
    let cancelled = false
    void (async () => {
      if (!isSupabaseConfigured) return
      const { data } = await supabase
        .from('robot_sessions')
        .insert({
          user_id: user.id,
          account_id: account.id,
          method,
          strategy: strategyLabel,
          initial_balance: account.initialBalance,
          status: 'running',
        })
        .select('id')
        .maybeSingle()
      if (!cancelled && data?.id) {
        sessionIdRef.current = data.id
        accountIdRef.current = account.id
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // Record equity history points while running (throttled to ~1/sec).
  useEffect(() => {
    if (!user || !running || !account) return
    const sessionId = sessionIdRef.current
    if (!sessionId || !isSupabaseConfigured) return
    const now = Date.now()
    if (now - lastWriteRef.current < 1000) return
    lastWriteRef.current = now
    const unrealized = equity(account, rates) - account.balance
    void supabase.from('robot_history').insert({
      user_id: user.id,
      account_id: account.id,
      session_id: sessionId,
      balance: account.balance,
      equity: equity(account, rates),
      unrealized,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, running, rates])

  // Close the session when the robot stops.
  useEffect(() => {
    if (running || !sessionIdRef.current) return
    const sessionId = sessionIdRef.current
    const accountId = accountIdRef.current
    sessionIdRef.current = null
    accountIdRef.current = null
    if (!user || !account || !isSupabaseConfigured) return
    void supabase
      .from('robot_sessions')
      .update({
        ended_at: new Date().toISOString(),
        status: 'finished',
        final_balance: account.balance,
        pnl: account.balance - account.initialBalance,
        trade_count: account.trades.length,
      })
      .eq('id', sessionId)
    void supabase
      .from('robot_history')
      .insert({
        user_id: user.id,
        account_id: accountId,
        session_id: sessionId,
        balance: account.balance,
        equity: equity(account, rates),
        unrealized: equity(account, rates) - account.balance,
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, account])
}