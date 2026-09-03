export type Interval = '1min' | '5min' | '15min' | '30min' | '1h' | '4h' | '1day'

export type StrategyType = 'MA' | 'RSI' | 'MACD' | 'BOLLINGER'

export type StrategyParams = Record<string, number>

export interface StrategyConfig {
  pair: string
  interval: Interval
  type: StrategyType
  params: StrategyParams
}

/** One OHLC bar as returned by the market-data Edge Function. */
export interface Bar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type Signal = 'buy' | 'sell' | 'neutral'

/** Quote as returned by the market-data Edge Function (from Twelve Data `/quote`). */
export interface Quote {
  symbol: string
  price: number | null
  change: number | null
  percent_change: number | null
  open: number | null
  high: number | null
  low: number | null
  previous_close: number | null
  is_market_open: boolean | null
  datetime: string | null
  /** True when served from an expired cache because the upstream quota was hit. */
  stale?: boolean
  error?: string | null
}

export type TradeSide = 'long' | 'short'

export interface Trade {
  side: TradeSide
  entryTime: string
  entryPrice: number
  exitTime: string | null
  exitPrice: number | null
  /** Price movement in points (pips-ish). */
  pnl: number
  /** Percentage return on the trade. */
  pnlPct: number
  reason: string
  open: boolean
  /** Symbol the trade belongs to (multi-pair backtests). */
  symbol?: string
}

export interface EquityPoint {
  time: string
  equity: number
}

export interface BacktestMetrics {
  totalReturnPct: number
  winRatePct: number
  maxDrawdownPct: number
  profitFactor: number
  totalTrades: number
  wins: number
  losses: number
  netProfit: number
}

export interface BacktestResult {
  bars: Bar[]
  trades: Trade[]
  equityCurve: EquityPoint[]
  metrics: BacktestMetrics
  strategy: StrategyConfig
  startEquity: number
  finalEquity: number
}

export interface SavedStrategy {
  id: string
  user_id: string
  name: string
  pair: string
  interval: Interval
  strategy_type: StrategyType
  params: StrategyParams
  created_at: string
  updated_at: string
}

/** Signal computed for a pair, with the indicator values that produced it. */
export interface PairSignal {
  symbol: string
  signal: Signal
  price: number | null
  indicatorValues: { label: string; value: string }[]
  error?: string | null
}

/* ----------------------------- v2.0 platform types ---------------------------- */

export type UserRole = 'user' | 'admin'

/** Identity-verification state for a profile (manual admin review). */
export type IdentityStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export interface Profile {
  id: string
  display_name: string | null
  email: string | null
  role: UserRole
  referral_code: string
  referred_by: string | null
  commission_earned: number
  total_referrals: number
  trial_ends_at: string | null
  created_at: string
  /** Legal / real name as it appears on identity documents. */
  real_name: string | null
  /** Identity-verification state (unverified → pending → verified/rejected). */
  identity_status: IdentityStatus
  /** User-supplied identity document reference (e.g. passport / national ID). */
  identity_document: string | null
  identity_submitted_at: string | null
  identity_verified_at: string | null
  /** Admin note when a check is rejected (or an approval note). */
  identity_reason: string | null
  /** Whether the user accepted the "use at your own risk" disclaimer. */
  risk_accepted: boolean
  /** When the risk disclaimer was accepted. */
  risk_accepted_at: string | null
  /** WhatsApp number (E.164, e.g. +628123456789) for robot progress alerts. */
  whatsapp_phone: string | null
  /** Master switch for WhatsApp robot notifications. */
  whatsapp_enabled: boolean
  /** Daily win/loss summary (per robot session). */
  whatsapp_daily_summary: boolean
  /** Daily open/close trade summary. */
  whatsapp_trade_summary: boolean
  /** Robot start/stop events. */
  whatsapp_robot_events: boolean
  /** Maintenance / auto-tune progress alerts. */
  whatsapp_maintenance: boolean
}

/** Aggregate counts exposed publicly on the landing page (never profile rows). */
export interface PublicUserStats {
  registered: number
  active_24h: number
  active_7d: number
  active_30d: number
}

export interface PackageRow {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  duration_days: number
  commission_pct: number
  features: Record<string, unknown>
  /** How many robot slots the package unlocks. */
  robots: number
  /** How many MT4/5 account connections the package unlocks. */
  mt_accounts: number
  active: boolean
  sort: number
  created_at: string
}

export type SubscriptionStatus = 'pending' | 'active' | 'rejected' | 'expired'

export interface SubscriptionRow {
  id: string
  user_id: string
  package_id: string
  status: SubscriptionStatus
  amount: number
  payment_method: string
  tx_ref: string | null
  activated_by: string | null
  activated_at: string | null
  starts_at: string | null
  ends_at: string | null
  /** Robot slots this subscription unlocks (snapshotted from the package). */
  robots: number
  /** MT4/5 account slots this subscription unlocks (snapshotted from the package). */
  mt_accounts: number
  /** Billing duration the buyer chose (1, 7, 30, 90, 180 or 365 days). */
  duration_days: number
  created_at: string
  packages?: Pick<PackageRow, 'id' | 'name' | 'price' | 'currency' | 'duration_days' | 'robots' | 'mt_accounts'> | null
}

export type ReferralStatus = 'pending' | 'paid' | 'cancelled'

export interface ReferralRow {
  id: string
  referrer_id: string
  referred_id: string
  subscription_id: string | null
  commission_pct: number
  commission_amount: number
  status: ReferralStatus
  created_at: string
  profiles?: Pick<Profile, 'id' | 'email' | 'display_name'> | null
}

/** Approval state for an ad: user-submitted ads start pending, admins approve/reject. */
export type AdStatus = 'pending' | 'approved' | 'rejected'

export interface AdRow {
  id: string
  title: string
  image_url: string | null
  target_url: string | null
  placement: string
  active: boolean
  clicks: number
  /** Optional price promoted by the ad, in `price_currency`. Shown converted to the viewer's display currency. */
  price: number | null
  /** Currency the ad's `price` is denominated in (defaults to USD for display). */
  price_currency: string | null
  created_at: string
  /** Owner of a user-submitted ad (null for admin-created ads). */
  user_id: string | null
  /** 'pending' while awaiting admin review, then 'approved' or 'rejected'. */
  status: AdStatus
  /** Admin note when an ad is rejected (or approval note). */
  reason: string | null
  reviewed_at: string | null
  reviewed_by: string | null
}

/** What an add-on grants: more robot slots, more MT4/5 account slots, or ad slots. */
export type AddonKind = 'robot' | 'mt_account' | 'ads'

/** A purchasable add-on (admin-managed catalog). */
export interface AddonRow {
  id: string
  name: string
  description: string | null
  kind: AddonKind
  /** How many slots one purchase of this add-on grants. */
  amount: number
  price: number
  currency: string
  /** Billing duration in days (1, 7, 30, 90, 180 or 365). */
  duration_days: number
  active: boolean
  sort: number
  created_at: string
}

export type AddonPurchaseStatus = 'pending' | 'active' | 'rejected'

/** A user's purchase of an add-on (manual admin approval like subscriptions). */
export interface AddonPurchaseRow {
  id: string
  user_id: string
  addon_id: string
  status: AddonPurchaseStatus
  amount: number
  currency: string
  /** Billing duration in days the buyer chose (1, 7, 30, 90, 180 or 365). */
  duration_days: number
  payment_method: string | null
  tx_ref: string | null
  activated_by: string | null
  activated_at: string | null
  created_at: string
  addons?: Pick<AddonRow, 'id' | 'name' | 'kind' | 'amount' | 'price' | 'currency'> | null
}

export type BrokerStatus = 'available' | 'maintenance' | 'coming_soon'

export interface BrokerRow {
  id: string
  name: string
  slug: string
  logo_url: string | null
  description: string | null
  admin_referral_code: string | null
  requires_api_key: boolean
  live_url: string | null
  practice_url: string | null
  status: BrokerStatus
  sort: number
  created_at: string
  /** Execution platform this broker connects through (null → inferred from slug). */
  platform?: BrokerPlatform | null
}

export type BrokerPlatform = 'oanda' | 'mt4' | 'mt5'

export interface BrokerConnectionRow {
  id: string
  user_id: string
  broker_id: string
  api_key?: string // server-only: never SELECTed into the browser
  account_id: string | null
  account_type: 'practice' | 'live'
  /** Which trading platform this account belongs to (OANDA, MT4, MT5). */
  platform: BrokerPlatform
  /** MT4/MT5 server host (e.g. FxPro-Real03.mt5.com). */
  server: string | null
  /** Which robot slot this account is bound to (1 robot = 1 account). */
  robot_number: number
  status: string
  last_verified_at: string | null
  created_at: string
  brokers?: BrokerRow | null
}

/**
 * A robot ↔ trading-account assignment in the configurable matrix
 * (1 robot/1 account, 1 robot/multi account, multi robot/1 account, or
 * multi robot/multi account), gated by the subscription + add-on slot budget.
 */
export interface RobotAccountLinkRow {
  id: string
  user_id: string
  robot_number: number
  connection_id: string
  created_at: string
}

/** Status of the auto-generated REST API token for one broker connection. */
export interface BrokerTokenStatus {
  connection_id: string | null
  platform: string | null
  hasToken: boolean
  /** Masked preview (first 6 + last 4 chars) — never the raw token. */
  masked: string | null
  created_at: string | null
}

export interface SettingsRow {
  key: string
  value: Record<string, unknown>
  updated_at: string
}

/** A tracked ad impression/click for the per-user "Ads history" view. */
export type AdEventType = 'view' | 'click'

export interface AdEventRow {
  id: string
  user_id: string | null
  ad_id: string | null
  event_type: AdEventType
  created_at: string
  ads?: Pick<AdRow, 'id' | 'title' | 'target_url'> | null
}

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected'

export interface WithdrawalRow {
  id: string
  user_id: string
  amount: number
  method: string
  wallet_address: string
  /** Specific bank/e-wallet/network the payout should go to (e.g. "BCA"). */
  method_detail: string | null
  /** Name the payout should be addressed to. */
  account_holder: string | null
  status: WithdrawalStatus
  processed_by: string | null
  processed_at: string | null
  created_at: string
}

export type WithdrawalMethod = 'bank' | 'ewallet' | 'international' | 'usdt' | 'other'

/** A user's saved payout account (set once, reused by the Wallet form). */
export interface WithdrawalAccountRow {
  id: string
  user_id: string
  method: WithdrawalMethod
  label: string
  details: Record<string, string>
  is_default: boolean
  created_at: string
  updated_at: string
}

export type PaymentMethod = 'qris' | 'bank' | 'ewallet' | 'paypal' | 'usdt'

/** An admin-managed receiving account shown to buyers on the Packages page. */
export interface PaymentAccountRow {
  id: string
  method: PaymentMethod
  label: string
  details: Record<string, string>
  enabled: boolean
  sort: number
  created_at: string
  updated_at: string
}

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

/** A notification: user-targeted (user_id set) or admin broadcast (user_id null). */
export interface NotificationRow {
  id: string
  user_id: string | null
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

/** Robot trading style: scalping (fast, tight stops) vs long-term (slow, wide). */
export type TradingMethod = 'scalping' | 'longterm'

export interface RobotPrefs {
  method: TradingMethod
  durationMinutes: number | null
  /** Watchlist pairs the robot should trade simultaneously (multi-pair). */
  pairs: string[]
  /** When true, the robot auto-picks the highest-probability pairs instead of only the manually selected ones. */
  autoPickPairs: boolean
  /** How many top pairs to auto-pick when autoPickPairs is on. */
  pairCount: number
  /** Per-trade take-profit in pips (0 = automatic from ATR / risk:reward). */
  perTradeTakeProfitPips: number
  /** Per-trade stop-loss in pips (0 = automatic from ATR / default stop). */
  perTradeStopLossPips: number
  /** Overall run profit target in USD — robot stops once the session reaches it (0 = off). */
  overallMaxProfitUsd: number
  /** Overall run loss limit in USD — robot stops once the session reaches it (0 = off). */
  overallMaxLossUsd: number
  /** Trade mode: one open position per pair at a time, or N concurrent (ladder). */
  tradeMode: 'sequential' | 'concurrent'
  /** Concurrent mode only: max open positions on the same pair. */
  maxPerPair: number
  /** Global cap on open positions across all watchlist pairs. */
  maxOpenTrades: number
}

/** Result of the auto-tune optimizer. */
export interface TunedResult {
  params: Record<string, number>
  totalReturnPct: number
  winRatePct: number
  profitFactor: number
  trades: number
}

/** Admin-managed contact details shown on the public Contact page (single row, id = 1). */
export interface ContactSettings {
  id: number
  email: string
  whatsapp: string
  phone: string
  updated_at: string
}