import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import type {
  AccountState,
  ApplySignalInput,
  BrokerMode,
  CloseReason,
  OpenPositionRequest,
  RatesMap,
  RiskConfig,
  RobotConfig,
  RobotCycleInput,
  Side,
} from './types'
import { applySignal, canOpen, closeAllPositions, closeRobotPositions as engineCloseRobotPositions, createAccount, openPosition } from './engine'
import { clearLocal, loadLocal, loadRemote, resetRemote, saveLocal, saveRemote } from './persistence'
import { createBroker, type BrokerAdapter } from './broker'

const MODE_KEY = 'fx-toolkit.broker-mode'

function initialMode(): BrokerMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'oanda' || saved === 'mt' || saved === 'managed') return saved
    return 'paper'
  } catch {
    return 'paper'
  }
}

export const DEFAULT_PAPER_BALANCE = 10_000

/**
 * Owns the paper account lifecycle: loads (Supabase when signed in, otherwise
 * localStorage), persists on every change, and exposes a `BrokerAdapter` so the
 * UI never talks to the engine directly.
 */
export function usePaperAccount() {
  const { user } = useAuth()
  const [account, setAccount] = useState<AccountState | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<BrokerMode>(initialMode)

  const stateRef = useRef<AccountState | null>(null)
  stateRef.current = account
  const userRef = useRef(user)
  userRef.current = user

  useEffect(() => {
    let active = true
    setLoading(true)
    void (async () => {
      const u = userRef.current
      let next: AccountState | null = null
      if (u) next = await loadRemote(u)
      if (!next) next = loadLocal()
      if (!next) next = createAccount(DEFAULT_PAPER_BALANCE)
      if (active) {
        setAccount(next)
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user?.id])

  useEffect(() => {
    if (!account || loading) return
    // Persist accounts that live on the platform's own ledger (paper and the
    // "managed live" ledger). Live OANDA / MetaTrader mirrors are never saved —
    // their authoritative state is always re-fetched from the broker.
    if (account.broker === 'oanda' || account.broker === 'mt') return
    saveLocal(account)
    const u = userRef.current
    if (!u) return
    const id = setTimeout(() => {
      void saveRemote(u, account)
    }, 400)
    return () => clearTimeout(id)
  }, [account, loading])

  const commit = useCallback((next: AccountState) => setAccount(next), [])

  const broker = useMemo<BrokerAdapter>(
    () =>
      createBroker(mode, {
        getState: () => stateRef.current ?? createAccount(DEFAULT_PAPER_BALANCE),
        commit,
      }),
    [mode, commit],
  )

  // In live mode, pull the authoritative account from the broker as soon as the
  // broker adapter exists (before the first quote tick arrives). Only do this
  // when signed in — the broker bridges require a user session JWT and would
  // otherwise 401 for anonymous visitors (persisted live mode).
  useEffect(() => {
    if (mode === 'paper') return
    if (!userRef.current) return
    void broker.refresh()
  }, [mode, broker])

  const open = useCallback(
    (req: OpenPositionRequest, rates: RatesMap) => broker.openPosition(req, rates),
    [broker],
  )
  const close = useCallback(
    (id: string, reason: CloseReason, price: number, rates: RatesMap) =>
      broker.closePosition(id, reason, price, rates),
    [broker],
  )
  const sync = useCallback((rates: RatesMap) => broker.markToMarket(rates), [broker])
  const refresh = useCallback(() => broker.refresh(), [broker])
  /** Submit one multi-pair robot cycle (caps + per-pair error isolation). */
  const runCycle = useCallback(
    (inputs: RobotCycleInput[], config: RobotConfig) => broker.runCycle(inputs, config),
    [broker],
  )

  /**
   * Act on a strategy signal. In paper mode this runs the pure engine reducer.
   * In live (OANDA) mode it validates against the same risk rules, then routes
   * the actual order through the broker so real money moves on the user's
   * account. The authoritative mirror state is refreshed from the broker after
   * every execution.
   */
  const runSignal = useCallback(
    async (input: ApplySignalInput): Promise<{ events: string[] }> => {
      const cur = stateRef.current
      if (!cur) return { events: ['No account yet — create one first.'] }

      if (broker.mode !== 'paper') {
        const { symbol, signal, price, rates, strategy, stopPips, takeProfitPips, units } = input
        if (signal === 'neutral') return { events: [] }
        const events: string[] = []
        const side: Side = signal === 'buy' ? 'long' : 'short'
        const pos = cur.positions.find((p) => p.symbol === symbol)

        if (pos) {
          if (pos.side === side) return { events: [] } // already on the right side
          const { error } = await broker.closePosition(pos.id, 'signal', price, rates)
          if (error) return { events: [`${symbol}: couldn't flip — ${error}`] }
          events.push(`Closed ${symbol} ${pos.side} on reversal (${price.toFixed(5)}).`)
        }

        const gate = canOpen(cur, rates)
        if (!gate.ok) return { events: [gate.reason ?? 'Risk limit.'] }

        const planned = openPosition(
          cur,
          { symbol, side, entryPrice: price, stopPips, takeProfitPips, units, strategy },
          rates,
        )
        if (planned.error) return { events: [`${symbol}: ${planned.error}`] }

        const { error } = await broker.openPosition(
          { symbol, side, entryPrice: price, stopPips, takeProfitPips, units, strategy },
          rates,
        )
        if (error) return { events: [`${symbol}: live order failed — ${error}`] }
        events.push(`Opened ${symbol} ${side} at ${price.toFixed(5)} (${broker.label}).`)
        return { events }
      }

      const { state, events } = applySignal(cur, input)
      setAccount(state)
      return { events }
    },
    [broker],
  )

  const setRisk = useCallback((patch: Partial<RiskConfig>) => {
    const cur = stateRef.current
    if (!cur) return
    setAccount({ ...cur, risk: { ...cur.risk, ...patch } })
  }, [])

  /** Emergency stop: disable auto-trading. */
  const stopRobot = useCallback(() => {
    const cur = stateRef.current
    if (!cur) return
    if (!cur.risk.autoTrade) return
    setAccount({ ...cur, risk: { ...cur.risk, autoTrade: false } })
  }, [])

  /** Close every open position at the current market price (stop-loss button). */
  const closeAll = useCallback(
    (rates: RatesMap): { closed: number } => {
      const cur = stateRef.current
      if (!cur || cur.positions.length === 0) return { closed: 0 }
      const { state, closed } = closeAllPositions(cur, rates)
      setAccount(state)
      return { closed: closed.length }
    },
    [],
  )

  /** Close only robot-opened (strategy-tagged) positions at market, leaving
   * manual positions open. Called when the robot stops. */
  const closeRobotPositions = useCallback(
    (rates: RatesMap): { closed: number } => {
      const cur = stateRef.current
      if (!cur || cur.positions.length === 0) return { closed: 0 }
      const { state, closed } = engineCloseRobotPositions(cur, rates)
      if (closed.length > 0) setAccount(state)
      return { closed: closed.length }
    },
    [],
  )

  const reset = useCallback(
    (initialBalance: number) => {
      clearLocal()
      setAccount(createAccount(initialBalance))
      // Wipe the Supabase mirror too, otherwise a signed-in user's reload loads
      // the old account + trades back from the server (see resetRemote).
      const u = userRef.current
      if (u) void resetRemote(u, initialBalance)
    },
    [],
  )

  const setBrokerMode = useCallback((m: BrokerMode) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* noop */
    }
    // Keep the account's `broker` label in sync for the ledger-backed modes
    // (paper and managed live). OANDA / MT are overwritten by the live mirror
    // when it next refreshes from the broker.
    if (m === 'paper' || m === 'managed') {
      setAccount((cur) => (cur ? { ...cur, broker: m } : cur))
    }
  }, [])

  return {
    account,
    loading,
    mode,
    setBrokerMode,
    broker,
    open,
    close,
    sync,
    refresh,
    runCycle,
    runSignal,
    setRisk,
    stopRobot,
    closeAll,
    closeRobotPositions,
    reset,
  }
}