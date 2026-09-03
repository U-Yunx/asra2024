/**
 * Types for the trading engine (paper robot + broker adapters).
 *
 * Everything is denominated in the account currency (USD). Positions are
 * measured in "units" of the base currency and PnL is converted to USD using
 * the live watchlist rates — the same math the robot uses to size positions.
 */

export type Side = 'long' | 'short'

export type PositionStatus = 'open' | 'closed'

export type CloseReason = 'signal' | 'stop_loss' | 'take_profit' | 'manual' | 'risk' | 'robot_stop'

export type BrokerMode = 'paper' | 'managed' | 'oanda' | 'mt'

/** Live price per watchlist symbol (symbol -> price). */
export interface RatesMap {
  [symbol: string]: number
}

/** An open position. */
export interface Position {
  id: string
  symbol: string
  side: Side
  units: number
  entryPrice: number
  entryTime: string
  stopPrice: number
  takeProfitPrice: number
  /** Account equity at the moment the position was opened (for PnL %). */
  entryEquity: number
  strategy?: string
  status: 'open'
}

/** A fully closed trade, retained for the journal. */
export interface ClosedTrade {
  id: string
  symbol: string
  side: Side
  units: number
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  stopPrice: number
  takeProfitPrice: number
  /** Account equity at the moment the position was opened (for PnL %). */
  entryEquity: number
  /** Realized PnL in account currency (USD). */
  pnl: number
  pnlPct: number
  closeReason: CloseReason
  strategy?: string
  status: 'closed'
}

/** Risk-management knobs the robot enforces. */
export interface RiskConfig {
  /** % of equity risked per trade (position sizing). */
  riskPerTradePct: number
  /** Max concurrently open positions (across all robot pairs). */
  maxOpenPositions: number
  /** Default stop-loss distance in pips. */
  defaultStopPips: number
  /** Take-profit distance as a multiple of the stop (risk:reward). */
  takeProfitRatio: number
  /** Daily loss limit as % of starting balance — blocks new entries when hit. */
  maxDailyLossPct: number
  /** When true, the robot acts on strategy signals automatically. */
  autoTrade: boolean
  /** When true, the stop-loss ratchets toward price once a trade is in profit. */
  trailingStop: boolean
  /** How far (in pips) the trailing stop trails behind the best price. */
  trailPips: number
  /** Move the stop to break-even once price is this many pips in profit. */
  breakEvenPips: number
  /** Start trailing the stop only after price is this many pips in profit. */
  trailActivationPips: number
}

export const DEFAULT_RISK: RiskConfig = {
  riskPerTradePct: 1,
  maxOpenPositions: 5,
  defaultStopPips: 20,
  takeProfitRatio: 2,
  maxDailyLossPct: 5,
  autoTrade: false,
  trailingStop: true,
  trailPips: 15,
  breakEvenPips: 10,
  trailActivationPips: 12,
}

/** The full persisted state of a paper account. */
export interface AccountState {
  id: string | null
  broker: BrokerMode
  currency: 'USD'
  initialBalance: number
  balance: number
  risk: RiskConfig
  positions: Position[]
  trades: ClosedTrade[]
  createdAt: string | null
  updatedAt: string | null
}

export interface OpenPositionRequest {
  symbol: string
  side: Side
  entryPrice: number
  stopPips: number
  takeProfitPips: number
  units: number
  strategy?: string
  time?: string
}

export interface ApplySignalInput {
  symbol: string
  signal: 'buy' | 'sell' | 'neutral'
  price: number
  rates: RatesMap
  strategy?: string
  stopPips: number
  takeProfitPips: number
  units: number
}

/** Per-strategy trade mode: one open position per pair vs. N concurrent. */
export type TradeMode = 'sequential' | 'concurrent'

/**
 * Multi-trade / multi-pair robot configuration (Phase 2). A single-pair robot
 * is just a watchlist of 1 with tradeMode 'sequential' — backward compatible.
 */
export interface RobotConfig {
  /** Watchlist of 1..N symbols the robot scans each cycle. */
  pairs: string[]
  /** 'sequential' → max 1 open position per pair; 'concurrent' → up to maxPerPair. */
  tradeMode: TradeMode
  /** Concurrent mode only: max open positions on the same pair. */
  maxPerPair: number
  /** Global cap on open positions across all pairs (0 = no cap beyond risk). */
  maxOpenTrades: number
}

export const DEFAULT_ROBOT_CONFIG: RobotConfig = {
  pairs: [],
  tradeMode: 'sequential',
  maxPerPair: 1,
  maxOpenTrades: 0,
}

/** Input for a single pair inside a multi-pair robot cycle. */
export interface RobotCycleInput extends ApplySignalInput {}