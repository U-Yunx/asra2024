/**
 * Records robot runs as sessions + equity history so users can review past
 * performance (Performance page) and admins can see robot usage. Defensive:
 * silently no-ops for anonymous visitors and when Supabase is unavailable.
 *
 * Sessions are closed when the robot stops AND when the component unmounts
 * (navigation away / refresh) — without the unmount close, every page load
 * with auto-trading persisted would leak a phantom 'running' session.
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
  // Latest values mirrored into refs so the unmount cleanup can close the
  // session with final figures even while the component is being torn down.
  const userRef = useRef(user)
  userRef.current = user
  const accountRef = useRef(account)
  accountRef.current = account
  const ratesRef = useRef(rates)
  ratesRef.current = rates

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

  // Close the current session with final figures. Idempotent — a null
  // session id means it already ran (stop, account change, unmount).
  const closeSession = () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    const accountId = accountIdRef.current
    sessionIdRef.current = null
    accountIdRef.current = null
    const u = userRef.current
    const acc = accountRef.current
    if (!u || !acc || !isSupabaseConfigured) return
    void supabase
      .from('robot_sessions')
      .update({
        ended_at: new Date().toISOString(),
        status: 'finished',
        final_balance: acc.balance,
        pnl: acc.balance - acc.initialBalance,
        trade_count: acc.trades.length,
      })
      .eq('id', sessionId)
    void supabase
      .from('robot_history')
      .insert({
        user_id: u.id,
        account_id: accountId,
        session_id: sessionId,
        balance: acc.balance,
        equity: equity(acc, ratesRef.current),
        unrealized: equity(acc, ratesRef.current) - acc.balance,
      })
  }
  const closeSessionRef = useRef(closeSession)
  closeSessionRef.current = closeSession

  // Close the session when the robot stops. `account` is in the deps so a
  // late-resolving session insert (robot stopped before the insert landed)
  // still gets closed on the next account change.
  useEffect(() => {
    if (running) return
    closeSessionRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, account])

  // Close on unmount (navigate away / refresh / sign out) so a reload can
  // never leak a phantom 'running' session for a robot the page is no longer
  // running. The server-side runner opens its own session when it takes over.
  useEffect(() => {
    return () => {
      closeSessionRef.current()
    }
  }, [])
}
