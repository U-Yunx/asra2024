/**
 * Broker adapter interface.
 *
 * The robot talks to a `BrokerAdapter`, not to any single execution venue.
 * Two implementations exist:
 *   - `PaperBroker`       simulated execution against the in-memory paper engine.
 *   - `OandaBrokerAdapter` real execution on the user's OANDA account, proxied
 *                         through the `broker-oanda` Edge Function so the API
 *                         key never leaves the server. It keeps a live mirror
 *                         of the account (balance, positions, journal) that the
 *                         UI renders exactly like paper trading.
 */
import { fn } from '../functions'
import { canOpen, closePosition, markToMarket, openPosition, runRobotCycle } from './engine'
import { pipSize, stopTakePrices } from './risk'
import type {
  AccountState,
  BrokerMode,
  ClosedTrade,
  CloseReason,
  OpenPositionRequest,
  Position,
  RatesMap,
  RobotConfig,
  RobotCycleInput,
  Side,
} from './types'

/** Cache of the robot REST API token per (platform, robot slot), refreshed on demand. */
const robotTokenCache = new Map<string, { token: string; at: number }>()

/**
 * Fetch the caller's robot REST API token for a platform / robot slot and cache
 * it briefly. The token authorizes open/close on the broker bridges; it is
 * scoped to the signed-in user and never stored client-side. When a
 * `connectionId` is given (the live account the UI is showing), the token is
 * fetched for that exact connection so each connected broker has its own.
 */
async function robotTokenFor(
  platform: 'oanda' | 'mt',
  robotNumber = 1,
  connectionId?: string,
): Promise<string | null> {
  const key = `${platform}:${robotNumber}:${connectionId ?? ''}`
  const hit = robotTokenCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.token
  const { data } = await fn<{ token?: string }>('broker-token', {
    body: { action: 'get', platform, robot_number: robotNumber, connection_id: connectionId },
    fallback: 'Could not read your robot REST API token.',
  })
  const token = data?.token ?? null
  if (token) robotTokenCache.set(key, { token, at: Date.now() })
  else robotTokenCache.delete(key)
  return token
}

export interface BrokerAdapter {
  readonly mode: BrokerMode
  readonly label: string
  readonly ready: boolean
  /** Human-readable explanation shown in the UI when `ready` is false. */
  readonly setupHint: string | null
  openPosition(req: OpenPositionRequest, rates: RatesMap): Promise<{ error: string | null }>
  closePosition(
    id: string,
    reason: CloseReason,
    price: number,
    rates: RatesMap,
  ): Promise<{ error: string | null }>
  /** Refresh with latest rates; closes anything whose SL/TP was hit. */
  markToMarket(rates: RatesMap): Promise<{ closed: number; error: string | null }>
  /** Re-sync the authoritative state from the venue (live brokers). */
  refresh(): Promise<{ error: string | null }>
  /**
   * Run one multi-pair robot cycle: submit an order for every qualifying pair
   * (subject to the per-pair and global caps), throttled per order so broker
   * rate limits are respected. Paper/managed run the pure engine reducer;
   * live brokers submit real orders and isolate per-pair failures.
   */
  runCycle(inputs: RobotCycleInput[], config: RobotConfig): Promise<{ events: string[] }>
}

/** Simulated execution against the in-memory paper engine. */
export class PaperBroker implements BrokerAdapter {
  readonly mode: BrokerMode = 'paper'
  readonly label = 'Paper trading'
  readonly ready = true
  readonly setupHint: string | null = null

  private getState: () => AccountState
  private commit: (next: AccountState) => void

  constructor(getState: () => AccountState, commit: (next: AccountState) => void) {
    this.getState = getState
    this.commit = commit
  }

  async openPosition(req: OpenPositionRequest, rates: RatesMap): Promise<{ error: string | null }> {
    const { state, error } = openPosition(this.getState(), req, rates)
    if (error) return { error }
    this.commit(state)
    return { error: null }
  }

  async closePosition(
    id: string,
    reason: CloseReason,
    price: number,
    rates: RatesMap,
  ): Promise<{ error: string | null }> {
    const res = closePosition(this.getState(), id, { price, reason, rates })
    if (!res.trade) return { error: 'Position not found.' }
    this.commit(res.state)
    return { error: null }
  }

  async markToMarket(rates: RatesMap): Promise<{ closed: number; error: string | null }> {
    const { state, closed } = markToMarket(this.getState(), rates)
    if (closed.length) this.commit(state)
    return { closed: closed.length, error: null }
  }

  async refresh(): Promise<{ error: string | null }> {
    return { error: null }
  }

  async runCycle(inputs: RobotCycleInput[], config: RobotConfig): Promise<{ events: string[] }> {
    const cur = this.getState()
    const { state, events } = runRobotCycle(cur, inputs, config)
    if (state !== cur) this.commit({ ...state, broker: 'paper' })
    return { events }
  }
}

/**
 * "Live (managed)" — a real-money-style live account on the platform's own
 * ledger. It runs the exact same engine and risk rules as paper trading, but is
 * presented to the trader as a live working account with real-size positions.
 * Unlike the OANDA/MT bridges it needs no external broker token — no MetaApi
 * key, no REST API key — so live trading never depends on a third party being
 * reachable. The account is persisted like paper (it *is* the authoritative
 * source of truth), not mirrored from an external venue.
 */
export class ManagedBroker implements BrokerAdapter {
  readonly mode: BrokerMode = 'managed'
  readonly label = 'Managed live'
  readonly ready = true
  readonly setupHint: string | null = null

  private getState: () => AccountState
  private commit: (next: AccountState) => void

  constructor(getState: () => AccountState, commit: (next: AccountState) => void) {
    this.getState = getState
    this.commit = commit
  }

  async openPosition(req: OpenPositionRequest, rates: RatesMap): Promise<{ error: string | null }> {
    const { state, error } = openPosition(this.getState(), req, rates)
    if (error) return { error }
    this.commit({ ...state, broker: 'managed' })
    return { error: null }
  }

  async closePosition(
    id: string,
    reason: CloseReason,
    price: number,
    rates: RatesMap,
  ): Promise<{ error: string | null }> {
    const res = closePosition(this.getState(), id, { price, reason, rates })
    if (!res.trade) return { error: 'Position not found.' }
    this.commit({ ...res.state, broker: 'managed' })
    return { error: null }
  }

  async markToMarket(rates: RatesMap): Promise<{ closed: number; error: string | null }> {
    const { state, closed } = markToMarket(this.getState(), rates)
    if (closed.length) this.commit({ ...state, broker: 'managed' })
    return { closed: closed.length, error: null }
  }

  async refresh(): Promise<{ error: string | null }> {
    return { error: null }
  }

  async runCycle(inputs: RobotCycleInput[], config: RobotConfig): Promise<{ events: string[] }> {
    const cur = this.getState()
    const { state, events } = runRobotCycle(cur, inputs, config)
    if (state !== cur) this.commit({ ...state, broker: 'managed' })
    return { events }
  }
}

/** Minimal shapes of the OANDA v20 objects this adapter cares about. */
interface OandaTrade {
  id: string
  instrument: string
  initialUnits: string
  currentUnits: string
  price: string
  averageClosePrice?: string
  openTime: string
  closeTime?: string
  state: string
  realizedPL?: string
  reason?: string
  stopLoss?: { price: string }
  takeProfit?: { price: string }
  clientExtensions?: { comment?: string }
}

interface OandaAccount {
  id?: string
  balance?: string
  NAV?: string
  openTradeCount?: string
  currency?: string
}

const REASON_MAP: Record<string, CloseReason> = {
  STOP_LOSS: 'stop_loss',
  TAKE_PROFIT: 'take_profit',
  MARGIN_CLOSEOUT: 'risk',
  POSITION_CLOSEOUT: 'risk',
}

/** Turn a raw bridge error into something a trader can act on. */
function friendlyBridgeError(err: string | null, fallback: string): string {
  if (!err) return fallback
  if (/invalid session|missing authorization/i.test(err)) {
    return 'Please sign in to use your live broker connection.'
  }
  if (/no .* connection saved|connect your broker|add your/i.test(err)) {
    return 'Connect your broker on the Brokers page first.'
  }
  if (/account_deploying|deploying on the metaapi cloud|connecting for the first time/i.test(err)) {
    return 'Connecting to your MetaTrader account (first-time setup takes about a minute) — the app reconnects automatically.'
  }
  if (/no metaapi token|no general metaapi token/i.test(err)) {
    return 'Add your free MetaApi token on the Brokers page to enable live trading (or ask an admin to set the platform token).'
  }
  if (/provision_failed|provision this account/i.test(err)) {
    return `MetaTrader could not be provisioned in the MetaApi cloud. ${err}`
  }
  return err
}

/** Minimum spacing between live order submissions within one cycle (ms). */
const ORDER_THROTTLE_MS = 350

/** Longer pause after a rate-limit response before the next order (ms). */
const RATE_LIMIT_BACKOFF_MS = 1500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Detect rate-limit (429 / throttling) responses from the broker bridges. */
function isRateLimit(error: string | null): boolean {
  return /rate.?limit|too many requests|throttl|\b429\b/i.test(error ?? '')
}

/**
 * Serialized multi-order submission for the live adapters. For each qualifying
 * pair (signal, under both caps, risk gate clear) it places one order through
 * the adapter, throttled per submission so broker rate limits are respected.
 * A rate-limit or rejected order is recorded against that pair only — the rest
 * of the cycle continues untouched.
 */
async function liveRunCycle(
  adapter: Pick<BrokerAdapter, 'openPosition' | 'label'>,
  getState: () => AccountState,
  inputs: RobotCycleInput[],
  config: RobotConfig,
): Promise<{ events: string[] }> {
  const events: string[] = []
  let mirror = getState()
  for (const input of inputs) {
    if (input.signal === 'neutral') continue
    const side: Side = input.signal === 'buy' ? 'long' : 'short'
    const perPairCap = config.tradeMode === 'concurrent' ? config.maxPerPair : 1
    const onSymbol = mirror.positions.filter((p) => p.symbol === input.symbol).length
    if (onSymbol >= perPairCap) {
      events.push(`Skipped ${input.symbol}: ${onSymbol} open, per-pair cap ${perPairCap} reached.`)
      continue
    }
    if (config.maxOpenTrades > 0 && mirror.positions.length >= config.maxOpenTrades) {
      events.push(`Deferred ${input.symbol}: global cap ${config.maxOpenTrades} reached.`)
      continue
    }
    const gate = canOpen(mirror, input.rates)
    if (!gate.ok) {
      events.push(gate.reason ?? `${input.symbol}: risk limits block this trade.`)
      continue
    }
    await sleep(ORDER_THROTTLE_MS)
    const res = await adapter.openPosition(
      {
        symbol: input.symbol,
        side,
        entryPrice: input.price,
        stopPips: input.stopPips,
        takeProfitPips: input.takeProfitPips,
        units: input.units,
        strategy: input.strategy,
      },
      input.rates,
    )
    if (res.error) {
      events.push(
        isRateLimit(res.error)
          ? `${input.symbol}: broker rate-limited — throttling and retrying next cycle. (${res.error})`
          : `${input.symbol}: ${res.error}`,
      )
      if (isRateLimit(res.error)) await sleep(RATE_LIMIT_BACKOFF_MS)
      continue
    }
    events.push(`Opened ${input.symbol} ${side} at ${input.price.toFixed(5)} (${adapter.label}).`)
    mirror = getState()
  }
  return { events }
}

/** Real execution on the user's OANDA account via the broker-oanda Edge Function. */
export class OandaBrokerAdapter implements BrokerAdapter {
  readonly mode: BrokerMode = 'oanda'
  readonly label = 'OANDA live'
  readonly ready = true
  readonly setupHint: string | null = null

  private getState: () => AccountState
  private commit: (next: AccountState) => void
  private lastSig = ''
  private knownClosed = new Set<string>()
  /** UTC day key the daily-loss baseline is anchored to (see refreshLive). */
  private dayKey = ''
  private dayStartBalance = 0
  /** The exact broker_connections row this adapter trades (if known). */
  private connectionId?: string

  constructor(getState: () => AccountState, commit: (next: AccountState) => void, connectionId?: string) {
    this.getState = getState
    this.commit = commit
    this.connectionId = connectionId
  }

  private api(action: string, body: Record<string, unknown> = {}) {
    // Pin every call to THIS connection so a user with several brokers never
    // hits a different one's account. The bridge falls back to the default
    // slot when no id is known (legacy single-connection behaviour).
    return fn<Record<string, unknown>>('broker-oanda', {
      body: { action, ...(this.connectionId ? { connection_id: this.connectionId } : {}), ...body },
      fallback: 'Could not reach your broker. Try again.',
    })
  }

  /**
   * Pull the authoritative account state from OANDA (summary + open trades +
   * recent closed trades) and commit it as the live mirror. Only commits when
   * something actually changed so quote-driven re-renders don't loop.
   */
  private async refreshLive(): Promise<{ error: string | null }> {
    const [summaryRes, openRes, closedRes] = await Promise.all([
      this.api('summary'),
      this.api('open-trades'),
      this.api('closed-trades'),
    ])

    const summary = summaryRes.data as { ok?: boolean; account?: OandaAccount; error?: string } | null
    const open = openRes.data as { ok?: boolean; trades?: OandaTrade[]; error?: string } | null
    const closed = closedRes.data as { ok?: boolean; trades?: OandaTrade[]; error?: string } | null

    const bridgeError = summaryRes.error ?? openRes.error ?? closedRes.error
    if (bridgeError) {
      return { error: friendlyBridgeError(bridgeError, 'Could not reach your broker. Check your connection and try again.') }
    }
    if (!summary?.ok || !summary.account) return { error: summary?.error ?? 'Could not load your live account.' }
    if (!open?.ok || !closed?.ok) return { error: open?.error ?? closed?.error ?? 'Could not load your live positions.' }

    const balance = Number(summary.account.balance ?? 0)

    const positions: Position[] = (open.trades ?? []).map((t) => {
      const units = Number(t.currentUnits ?? t.initialUnits ?? 0)
      return {
        id: String(t.id),
        symbol: t.instrument.replace('_', '/'),
        side: units >= 0 ? ('long' as const) : ('short' as const),
        units: Math.abs(units),
        entryPrice: Number(t.price ?? 0),
        entryTime: t.openTime,
        stopPrice: t.stopLoss ? Number(t.stopLoss.price) : 0,
        takeProfitPrice: t.takeProfit ? Number(t.takeProfit.price) : 0,
        entryEquity: balance,
        strategy: t.clientExtensions?.comment || undefined,
        status: 'open' as const,
      }
    })

    const rawClosed = [...(closed.trades ?? [])].sort((a, b) =>
      String(b.closeTime ?? '').localeCompare(String(a.closeTime ?? '')),
    )
    const trades: ClosedTrade[] = rawClosed.map((t) => {
      const units = Number(t.initialUnits ?? 0)
      const pnl = Number(t.realizedPL ?? 0)
      const reasonKey = String(t.reason ?? '').toUpperCase()
      return {
        id: String(t.id),
        symbol: t.instrument.replace('_', '/'),
        side: units >= 0 ? ('long' as const) : ('short' as const),
        units: Math.abs(units),
        entryPrice: Number(t.price ?? 0),
        entryTime: t.openTime,
        exitPrice: Number(t.averageClosePrice ?? t.price ?? 0),
        exitTime: t.closeTime ?? new Date().toISOString(),
        stopPrice: t.stopLoss ? Number(t.stopLoss.price) : 0,
        takeProfitPrice: t.takeProfit ? Number(t.takeProfit.price) : 0,
        entryEquity: balance,
        pnl,
        pnlPct: balance > 0 ? (pnl / balance) * 100 : 0,
        closeReason: REASON_MAP[reasonKey] ?? 'manual',
        strategy: t.clientExtensions?.comment || undefined,
        status: 'closed' as const,
      }
    })

    // Count trades that closed since our last sync (for the robot log).
    let newlyClosed = 0
    for (const t of trades) {
      if (!this.knownClosed.has(t.id)) newlyClosed++
    }
    this.knownClosed = new Set(trades.map((t) => t.id))
    for (const p of positions) this.knownClosed.delete(p.id)

    const prev = this.getState()
    // Anchor the daily-loss baseline to the balance at the start of the UTC
    // day. Without this, `initialBalance` would track the current balance and
    // the maxDailyLossPct limit would silently shrink as losses accrued.
    const dayKey = new Date().toISOString().slice(0, 10)
    if (this.dayKey !== dayKey) {
      this.dayKey = dayKey
      this.dayStartBalance = balance
    }
    const next: AccountState = {
      ...prev,
      broker: 'oanda',
      currency: 'USD',
      initialBalance: this.dayStartBalance,
      balance,
      risk: prev.risk,
      positions,
      trades,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString(),
    }

    const sig = JSON.stringify([balance, positions, trades.slice(0, 50).map((t) => `${t.id}:${t.pnl}`)])
    if (sig !== this.lastSig) {
      this.lastSig = sig
      this.commit(next)
    }

    return { error: null }
  }

  async openPosition(req: OpenPositionRequest, _rates: RatesMap): Promise<{ error: string | null }> {
    // Send SL/TP as distances (price units from the fill) rather than absolute
    // prices: the market order can fill away from `req.entryPrice`, and an
    // absolute stop computed from a stale signal price could land on the wrong
    // side of the fill or far tighter than the intended risk. OANDA anchors
    // `distance` to the trade's open price.
    const pip = pipSize(req.symbol)
    const stopDistance = req.stopPips * pip
    const takeProfitDistance = Math.max(0, req.takeProfitPips) * pip
    if (!(stopDistance > 0)) return { error: 'A stop loss is required on every position.' }
    const units = Math.max(1, Math.round(req.units))

    const token = await robotTokenFor('oanda', 1, this.connectionId)
    const { data, error: fnErr } = await this.api('open-position', {
      symbol: req.symbol,
      side: req.side,
      units,
      stopDistance,
      takeProfitDistance,
      strategy: req.strategy,
      token,
    })
    if (fnErr) return { error: friendlyBridgeError(fnErr, 'Could not reach your broker. Try again.') }
    const res = data as { ok?: boolean; error?: string }
    if (!res?.ok) return { error: res?.error ?? 'OANDA rejected the order.' }

    await this.refreshLive()
    return { error: null }
  }

  async closePosition(
    id: string,
    _reason: CloseReason,
    _price: number,
    _rates: RatesMap,
  ): Promise<{ error: string | null }> {
    const token = await robotTokenFor('oanda', 1, this.connectionId)
    const { data, error: fnErr } = await this.api('close-position', { tradeId: id, token })
    if (fnErr) return { error: friendlyBridgeError(fnErr, 'Could not reach your broker. Try again.') }
    const res = data as { ok?: boolean; error?: string }
    if (!res?.ok) return { error: res?.error ?? 'OANDA could not close the position.' }

    await this.refreshLive()
    return { error: null }
  }

  async markToMarket(_rates: RatesMap): Promise<{ closed: number; error: string | null }> {
    const res = await this.refreshLive()
    if (res.error) return { closed: 0, error: res.error }
    return { closed: 0, error: null }
  }

  async refresh(): Promise<{ error: string | null }> {
    return this.refreshLive()
  }

  async runCycle(inputs: RobotCycleInput[], config: RobotConfig): Promise<{ events: string[] }> {
    return liveRunCycle(this, () => this.getState(), inputs, config)
  }
}

/** Minimal shapes of the MetaApi position / history-order objects this adapter cares about. */
interface MtPosition {
  id: string
  type: string
  symbol: string
  openPrice: number
  volume: number
  profit: number
  stopLoss?: number
  takeProfit?: number
  time: number
  comment?: string
}

interface MtHistoryOrder {
  id: string
  type: string
  symbol: string
  volume: number
  filledVolume?: number
  openPrice: number
  closePrice?: number
  profit: number
  state: string
  doneTime?: number
  comment?: string
  stopLoss?: number
  takeProfit?: number
}

/** One standard lot = 100,000 base units (matches the engine's unit semantics). */
const UNITS_PER_LOT = 100_000

/** MetaTrader symbol "EURUSD" -> app symbol "EUR/USD" (best-effort split). */
function mtAppSymbol(symbol: string): string {
  const s = symbol.toUpperCase()
  return s.length === 6 ? `${s.slice(0, 3)}/${s.slice(3)}` : s
}

/** Real execution on the user's MetaTrader 4/5 account via the broker-mt Edge
 *  Function, which proxies through MetaApi's cloud gateway. */
export class MtBrokerAdapter implements BrokerAdapter {
  readonly mode: BrokerMode = 'mt'
  readonly label = 'MetaTrader live'
  readonly ready = true
  readonly setupHint: string | null = null

  private getState: () => AccountState
  private commit: (next: AccountState) => void
  private lastSig = ''
  private knownClosed = new Set<string>()
  /** UTC day key the daily-loss baseline is anchored to (see refreshLive). */
  private dayKey = ''
  private dayStartBalance = 0
  /** The exact broker_connections row this adapter trades (if known). */
  private connectionId?: string

  constructor(getState: () => AccountState, commit: (next: AccountState) => void, connectionId?: string) {
    this.getState = getState
    this.commit = commit
    this.connectionId = connectionId
  }

  private api(action: string, body: Record<string, unknown> = {}) {
    // Pin every call to THIS connection so a user with several MT4/5 brokers
    // never trades a different one's account. The bridge falls back to the
    // default slot when no id is known (legacy single-connection behaviour).
    return fn<Record<string, unknown>>('broker-mt', {
      body: { action, ...(this.connectionId ? { connection_id: this.connectionId } : {}), ...body },
      fallback: 'Could not reach your broker. Try again.',
    })
  }

  /**
   * Pull the authoritative account state from MetaTrader via MetaApi (account
   * info + open positions + filled history) and commit it as the live mirror.
   * Only commits when something changed so quote-driven re-renders don't loop.
   */
  private async refreshLive(): Promise<{ error: string | null }> {
    const [summaryRes, openRes, closedRes] = await Promise.all([
      this.api('summary'),
      this.api('open-trades'),
      this.api('closed-trades'),
    ])

    const summary = summaryRes.data as
      | { ok?: boolean; account?: { balance?: number; equity?: number; currency?: string }; error?: string }
      | null
    const open = openRes.data as { ok?: boolean; positions?: MtPosition[]; error?: string } | null
    const closed = closedRes.data as { ok?: boolean; trades?: MtHistoryOrder[]; error?: string } | null

    const bridgeError = summaryRes.error ?? openRes.error ?? closedRes.error
    if (bridgeError) {
      return { error: friendlyBridgeError(bridgeError, 'Could not reach your broker. Check your connection and try again.') }
    }
    if (!summary?.ok || !summary.account) return { error: summary?.error ?? 'Could not load your live account.' }
    if (!open?.ok || !closed?.ok) return { error: open?.error ?? closed?.error ?? 'Could not load your live positions.' }

    const balance = Number(summary.account.balance ?? 0)

    const positions: Position[] = (open.positions ?? []).map((p) => {
      const side = p.type === 'POSITION_TYPE_BUY' ? ('long' as const) : ('short' as const)
      return {
        id: String(p.id),
        symbol: mtAppSymbol(p.symbol),
        side,
        units: Math.round(Number(p.volume ?? 0) * UNITS_PER_LOT),
        entryPrice: Number(p.openPrice ?? 0),
        entryTime: p.time ? new Date(p.time).toISOString() : new Date().toISOString(),
        stopPrice: Number(p.stopLoss ?? 0),
        takeProfitPrice: Number(p.takeProfit ?? 0),
        entryEquity: balance,
        strategy: p.comment || undefined,
        status: 'open' as const,
      }
    })

    const rawClosed = [...(closed.trades ?? [])].sort((a, b) =>
      Number(b.doneTime ?? 0) - Number(a.doneTime ?? 0),
    )
    const trades: ClosedTrade[] = rawClosed.map((t) => {
      const units = Math.round(Number(t.filledVolume ?? t.volume ?? 0) * UNITS_PER_LOT)
      const side = t.type === 'ORDER_TYPE_BUY' ? ('long' as const) : ('short' as const)
      const exitPrice = Number(t.closePrice ?? t.openPrice ?? 0)
      const pnl = Number(t.profit ?? 0)
      const closeReason: CloseReason =
        t.stopLoss != null && Math.abs(exitPrice - Number(t.stopLoss)) < 1e-9
          ? 'stop_loss'
          : t.takeProfit != null && Math.abs(exitPrice - Number(t.takeProfit)) < 1e-9
            ? 'take_profit'
            : 'manual'
      return {
        id: String(t.id),
        symbol: mtAppSymbol(t.symbol),
        side,
        units,
        entryPrice: Number(t.openPrice ?? 0),
        entryTime: t.doneTime ? new Date(Number(t.doneTime)).toISOString() : new Date().toISOString(),
        exitPrice,
        exitTime: t.doneTime ? new Date(Number(t.doneTime)).toISOString() : new Date().toISOString(),
        stopPrice: Number(t.stopLoss ?? 0),
        takeProfitPrice: Number(t.takeProfit ?? 0),
        entryEquity: balance,
        pnl,
        pnlPct: balance > 0 ? (pnl / balance) * 100 : 0,
        closeReason,
        strategy: t.comment || undefined,
        status: 'closed' as const,
      }
    })

    let newlyClosed = 0
    for (const t of trades) {
      if (!this.knownClosed.has(t.id)) newlyClosed++
    }
    this.knownClosed = new Set(trades.map((t) => t.id))
    for (const p of positions) this.knownClosed.delete(p.id)

    const prev = this.getState()
    // Anchor the daily-loss baseline to the balance at the start of the UTC
    // day. Without this, `initialBalance` would track the current balance and
    // the maxDailyLossPct limit would silently shrink as losses accrued.
    const dayKey = new Date().toISOString().slice(0, 10)
    if (this.dayKey !== dayKey) {
      this.dayKey = dayKey
      this.dayStartBalance = balance
    }
    const next: AccountState = {
      ...prev,
      broker: 'mt',
      currency: 'USD',
      initialBalance: this.dayStartBalance,
      balance,
      risk: prev.risk,
      positions,
      trades,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString(),
    }

    const sig = JSON.stringify([balance, positions, trades.slice(0, 50).map((t) => `${t.id}:${t.pnl}`)])
    if (sig !== this.lastSig) {
      this.lastSig = sig
      this.commit(next)
    }

    return { error: null }
  }

  async openPosition(req: OpenPositionRequest, _rates: RatesMap): Promise<{ error: string | null }> {
    const { stopPrice, takeProfitPrice } = stopTakePrices(
      req.symbol,
      req.side,
      req.entryPrice,
      req.stopPips,
      Math.max(0, req.takeProfitPips),
    )
    // Micro accounts: MetaTrader venues reject orders under 0.01 lots (1,000
    // units), so never send a dust order — floor the size at one micro lot.
    const units = Math.max(1_000, Math.round(req.units))

    const token = await robotTokenFor('mt', 1, this.connectionId)
    const { data, error: fnErr } = await this.api('open-position', {
      symbol: req.symbol,
      side: req.side,
      units,
      stopLoss: stopPrice,
      takeProfit: takeProfitPrice,
      strategy: req.strategy,
      token,
    })
    if (fnErr) return { error: friendlyBridgeError(fnErr, 'Could not reach your broker. Try again.') }
    const res = data as { ok?: boolean; error?: string }
    if (!res?.ok) return { error: res?.error ?? 'MetaTrader rejected the order.' }

    await this.refreshLive()
    return { error: null }
  }

  async closePosition(
    id: string,
    _reason: CloseReason,
    _price: number,
    _rates: RatesMap,
  ): Promise<{ error: string | null }> {
    const token = await robotTokenFor('mt', 1, this.connectionId)
    const { data, error: fnErr } = await this.api('close-position', { positionId: id, token })
    if (fnErr) return { error: friendlyBridgeError(fnErr, 'Could not reach your broker. Try again.') }
    const res = data as { ok?: boolean; error?: string }
    if (!res?.ok) return { error: res?.error ?? 'MetaTrader could not close the position.' }

    await this.refreshLive()
    return { error: null }
  }

  async markToMarket(_rates: RatesMap): Promise<{ closed: number; error: string | null }> {
    const res = await this.refreshLive()
    if (res.error) return { closed: 0, error: res.error }
    return { closed: 0, error: null }
  }

  async refresh(): Promise<{ error: string | null }> {
    return this.refreshLive()
  }

  async runCycle(inputs: RobotCycleInput[], config: RobotConfig): Promise<{ events: string[] }> {
    return liveRunCycle(this, () => this.getState(), inputs, config)
  }
}

export function createBroker(
  mode: BrokerMode,
  deps: { getState: () => AccountState; commit: (next: AccountState) => void },
  connectionId?: string,
): BrokerAdapter {
  if (mode === 'oanda') return new OandaBrokerAdapter(deps.getState, deps.commit, connectionId)
  if (mode === 'mt') return new MtBrokerAdapter(deps.getState, deps.commit, connectionId)
  if (mode === 'managed') return new ManagedBroker(deps.getState, deps.commit)
  return new PaperBroker(deps.getState, deps.commit)
}