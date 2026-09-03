/**
 * Data access for the v2.0 SaaS platform features (profiles, packages,
 * subscriptions, referrals, ads, brokers, settings). Every function talks to
 * Supabase through the anon client, so RLS governs what each user can touch.
 */
import { supabase } from './supabase'
import { fn } from './functions'
import type {
  AddonPurchaseRow,
  AddonPurchaseStatus,
  AddonRow,
  AdEventRow,
  AdEventType,
  AdRow,
  BrokerConnectionRow,
  BrokerRow,
  BrokerTokenStatus,
  ContactSettings,
  NotificationRow,
  NotificationType,
  PackageRow,
  PaymentAccountRow,
  PaymentMethod,
  Profile,
  PublicUserStats,
  ReferralRow,
  ReferralStatus,
  RobotAccountLinkRow,
  SettingsRow,
  SubscriptionRow,
  SubscriptionStatus,
  UserRole,
  WithdrawalAccountRow,
  WithdrawalMethod,
  WithdrawalRow,
  WithdrawalStatus,
} from './types'

/* --------------------------------- profiles -------------------------------- */

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  return (data as Profile | null) ?? null
}

/** Save the user's real name (as it appears on identity documents). */
export async function saveRealName(userId: string, realName: string): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ real_name: realName.trim() }).eq('id', userId)
  return error?.message ?? null
}

/** Request identity verification. RLS + the DB trigger ensure only admins can verify. */
export async function submitIdentityCheck(userId: string, document: string): Promise<string | null> {
  const { error } = await supabase
    .from('profiles')
    .update({ identity_status: 'pending', identity_document: document.trim() })
    .eq('id', userId)
  return error?.message ?? null
}

/** Admin review: approve or reject a user's identity check (optional note). */
export async function reviewIdentity(
  userId: string,
  status: 'verified' | 'rejected',
  note?: string,
): Promise<string | null> {
  const { error } = await supabase
    .from('profiles')
    .update({ identity_status: status, identity_reason: note?.trim() || null })
    .eq('id', userId)
  return error?.message ?? null
}

/** Accept the "trade at your own risk" disclaimer (required before trading). */
export async function acceptRisk(userId: string): Promise<string | null> {
  const { error } = await supabase
    .from('profiles')
    .update({ risk_accepted: true, risk_accepted_at: new Date().toISOString() })
    .eq('id', userId)
  return error?.message ?? null
}

/** Save the user's WhatsApp robot-notification preferences. */
export async function saveWhatsAppPrefs(
  userId: string,
  prefs: Pick<Profile, 'whatsapp_phone' | 'whatsapp_enabled' | 'whatsapp_daily_summary' | 'whatsapp_trade_summary' | 'whatsapp_robot_events' | 'whatsapp_maintenance'>,
): Promise<string | null> {
  const { error } = await supabase
    .from('profiles')
    .update({
      whatsapp_phone: prefs.whatsapp_phone?.trim() || null,
      whatsapp_enabled: prefs.whatsapp_enabled,
      whatsapp_daily_summary: prefs.whatsapp_daily_summary,
      whatsapp_trade_summary: prefs.whatsapp_trade_summary,
      whatsapp_robot_events: prefs.whatsapp_robot_events,
      whatsapp_maintenance: prefs.whatsapp_maintenance,
    })
    .eq('id', userId)
  return error?.message ?? null
}

export async function setUserRole(userId: string, role: UserRole): Promise<string | null> {
  // Admin toggling goes through the SECURITY DEFINER RPC, which re-checks
  // is_admin() server-side (direct UPDATE on profiles.role is rejected by the
  // guard_profile_role trigger unless the caller is an admin).
  const { error } = await supabase.rpc('set_user_role', { p_user_id: userId, p_role: role })
  return error?.message ?? null
}

export async function listUsers(): Promise<Profile[]> {
  const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
  return (data as Profile[]) ?? []
}

/** Public landing-page counts (registered + active users). Aggregate only. */
export async function fetchPublicUserStats(): Promise<PublicUserStats> {
  const { data } = await supabase.rpc('public_user_stats')
  // Table-returning functions come back as a JSON array of one row.
  const row = Array.isArray(data)
    ? (data[0] as PublicUserStats | undefined)
    : (data as PublicUserStats | undefined)
  const s: PublicUserStats = row ?? { registered: 0, active_24h: 0, active_7d: 0, active_30d: 0 }
  return {
    registered: Number(s.registered) || 0,
    active_24h: Number(s.active_24h) || 0,
    active_7d: Number(s.active_7d) || 0,
    active_30d: Number(s.active_30d) || 0,
  }
}

let lastTouchAt = 0
/** Throttled heartbeat so the public "active users" count reflects real usage. */
export async function touchLastActive(userId: string): Promise<void> {
  const now = Date.now()
  if (now - lastTouchAt < 5 * 60 * 1000) return
  lastTouchAt = now
  await supabase.from('profiles').update({ last_active: new Date().toISOString() }).eq('id', userId)
}

/* --------------------------------- packages -------------------------------- */

export async function fetchPackages(): Promise<PackageRow[]> {
  const { data } = await supabase
    .from('packages')
    .select('*')
    .order('sort', { ascending: true })
  return (data as PackageRow[]) ?? []
}

export async function savePackage(pkg: Partial<PackageRow> & { name: string; price: number }): Promise<string | null> {
  const { error } = await supabase.from('packages').upsert(pkg)
  return error?.message ?? null
}

export async function deletePackage(id: string): Promise<string | null> {
  const { error } = await supabase.from('packages').delete().eq('id', id)
  return error?.message ?? null
}

/* ------------------------------ subscriptions ------------------------------ */

const SUBSCRIPTION_SELECT = '*, packages(id, name, price, currency, duration_days, robots, mt_accounts)'

export async function fetchMySubscriptions(userId: string): Promise<SubscriptionRow[]> {
  const { data } = await supabase
    .from('subscriptions')
    .select(SUBSCRIPTION_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return (data as SubscriptionRow[]) ?? []
}

export async function fetchAllSubscriptions(): Promise<SubscriptionRow[]> {
  const { data } = await supabase
    .from('subscriptions')
    .select(SUBSCRIPTION_SELECT)
    .order('created_at', { ascending: false })
  return (data as SubscriptionRow[]) ?? []
}

export async function createSubscription(input: {
  user_id: string
  package_id: string
  amount: number
  tx_ref: string
  robots: number
  mt_accounts: number
  /** Billing duration in days the buyer chose (1, 7, 30, 90, 180 or 365). */
  duration_days?: number
  payment_method?: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('subscriptions').insert({
    user_id: input.user_id,
    package_id: input.package_id,
    status: 'pending',
    amount: input.amount,
    payment_method: input.payment_method ?? 'crypto',
    tx_ref: input.tx_ref || null,
    robots: input.robots,
    mt_accounts: input.mt_accounts,
    duration_days: input.duration_days ?? 30,
  })
  return { error: error?.message ?? null }
}

export async function setSubscriptionStatus(
  id: string,
  status: SubscriptionStatus,
): Promise<string | null> {
  const { error } = await supabase.from('subscriptions').update({ status }).eq('id', id)
  return error?.message ?? null
}

/* ---------------------------------- add-ons -------------------------------- */

/** Add-on catalog (active rows are public; admins also see hidden add-ons). */
export async function fetchAddons(): Promise<AddonRow[]> {
  const { data } = await supabase.from('addons').select('*').order('sort', { ascending: true })
  return (data as AddonRow[]) ?? []
}

export async function saveAddon(addon: Partial<AddonRow> & { name: string; kind: AddonRow['kind'] }): Promise<string | null> {
  const { error } = await supabase.from('addons').upsert(addon)
  return error?.message ?? null
}

export async function deleteAddon(id: string): Promise<string | null> {
  const { error } = await supabase.from('addons').delete().eq('id', id)
  return error?.message ?? null
}

const ADDON_PURCHASE_SELECT = '*, addons(id, name, kind, amount, price, currency)'

/** The signed-in user's add-on purchases (newest first). */
export async function fetchMyAddonPurchases(userId: string): Promise<AddonPurchaseRow[]> {
  const { data } = await supabase
    .from('addon_purchases')
    .select(ADDON_PURCHASE_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return (data as AddonPurchaseRow[]) ?? []
}

/** All add-on purchases, newest first (admin only — RLS enforces it). */
export async function fetchAllAddonPurchases(): Promise<AddonPurchaseRow[]> {
  const { data } = await supabase
    .from('addon_purchases')
    .select(ADDON_PURCHASE_SELECT)
    .order('created_at', { ascending: false })
  return (data as AddonPurchaseRow[]) ?? []
}

export async function createAddonPurchase(input: {
  user_id: string
  addon_id: string
  amount: number
  currency: string
  tx_ref: string
  /** Billing duration in days the buyer chose (1, 7, 30, 90, 180 or 365). */
  duration_days?: number
  payment_method?: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('addon_purchases').insert({
    user_id: input.user_id,
    addon_id: input.addon_id,
    status: 'pending',
    amount: input.amount,
    currency: input.currency,
    payment_method: input.payment_method ?? 'crypto',
    tx_ref: input.tx_ref || null,
    duration_days: input.duration_days ?? 30,
  })
  return { error: error?.message ?? null }
}

/** Admin approval: activate or reject an add-on purchase. */
export async function setAddonPurchaseStatus(
  id: string,
  status: Extract<AddonPurchaseStatus, 'active' | 'rejected'>,
): Promise<string | null> {
  const { error } = await supabase
    .from('addon_purchases')
    .update({ status, activated_at: new Date().toISOString() })
    .eq('id', id)
  return error?.message ?? null
}

/** Sum of slots granted by a user's active add-on purchases of one kind. */
export function activeAddonSlots(purchases: AddonPurchaseRow[], kind: AddonRow['kind']): number {
  return purchases
    .filter((p) => p.status === 'active' && p.addons?.kind === kind)
    .reduce((sum, p) => sum + (p.addons?.amount ?? 0), 0)
}

/* --------------------------------- referrals ------------------------------- */

export async function fetchDownline(userId: string): Promise<ReferralRow[]> {
  const { data } = await supabase
    .from('referrals')
    .select('*, profiles(id, email, display_name)')
    .eq('referrer_id', userId)
    .order('created_at', { ascending: false })
  return (data as ReferralRow[]) ?? []
}

export async function fetchAllReferrals(): Promise<ReferralRow[]> {
  const { data } = await supabase
    .from('referrals')
    .select('*, profiles(id, email, display_name)')
    .order('created_at', { ascending: false })
  return (data as ReferralRow[]) ?? []
}

export async function setReferralStatus(id: string, status: ReferralStatus): Promise<string | null> {
  const { error } = await supabase.from('referrals').update({ status }).eq('id', id)
  return error?.message ?? null
}

/* ------------------------------------ ads ---------------------------------- */

export async function fetchAds(): Promise<AdRow[]> {
  const { data } = await supabase
    .from('ads')
    .select('*')
    .order('created_at', { ascending: false })
  return (data as AdRow[]) ?? []
}

/** The signed-in user's own ads (any status), newest first. */
export async function fetchMyAds(userId: string): Promise<AdRow[]> {
  const { data } = await supabase
    .from('ads')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return (data as AdRow[]) ?? []
}

export async function saveAd(ad: Partial<AdRow> & { title: string }): Promise<string | null> {
  const { error } = await supabase.from('ads').upsert(ad)
  return error?.message ?? null
}

export async function deleteAd(id: string): Promise<string | null> {
  const { error } = await supabase.from('ads').delete().eq('id', id)
  return error?.message ?? null
}

/** User submits a new ad — it starts as `pending` until an admin approves it. */
export async function submitAd(input: {
  userId: string
  title: string
  imageUrl: string
  targetUrl: string
  price: number | null
  priceCurrency: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('ads').insert({
    user_id: input.userId,
    title: input.title.trim(),
    image_url: input.imageUrl.trim() || null,
    target_url: input.targetUrl.trim() || null,
    placement: 'global',
    active: false,
    status: 'pending',
    clicks: 0,
    price: input.price && input.price > 0 ? input.price : null,
    price_currency: input.price && input.price > 0 ? input.priceCurrency || 'USD' : null,
  })
  return { error: error?.message ?? null }
}

/** User edits one of their own ads (goes back to `pending` for re-review). */
export async function updateMyAd(
  id: string,
  input: { title: string; imageUrl: string; targetUrl: string; price: number | null; priceCurrency: string },
): Promise<string | null> {
  const { error } = await supabase
    .from('ads')
    .update({
      title: input.title.trim(),
      image_url: input.imageUrl.trim() || null,
      target_url: input.targetUrl.trim() || null,
      status: 'pending',
      active: false,
      price: input.price && input.price > 0 ? input.price : null,
      price_currency: input.price && input.price > 0 ? input.priceCurrency || 'USD' : null,
    })
    .eq('id', id)
  return error?.message ?? null
}

/** Admin review: approve or reject a user-submitted ad (optional note). */
export async function reviewAd(
  id: string,
  status: 'approved' | 'rejected',
  note?: string,
  adminId?: string,
): Promise<string | null> {
  const { error } = await supabase
    .from('ads')
    .update({
      status,
      active: status === 'approved',
      reason: note?.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminId ?? null,
    })
    .eq('id', id)
  return error?.message ?? null
}

export async function incrementAdClick(id: string): Promise<void> {
  await supabase.rpc('increment_ad_click', { ad_id: id })
}

/* -------------------------------- ad events -------------------------------- */

const AD_EVENT_SELECT = '*, ads(id, title, target_url)'

/** Ads history for the signed-in user (views + clicks). */
export async function fetchMyAdEvents(userId: string): Promise<AdEventRow[]> {
  const { data } = await supabase
    .from('ad_events')
    .select(AD_EVENT_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500)
  return (data as AdEventRow[]) ?? []
}

/** All ad events, newest first (admin only — RLS enforces it). */
export async function fetchAllAdEvents(): Promise<AdEventRow[]> {
  const { data } = await supabase
    .from('ad_events')
    .select(AD_EVENT_SELECT)
    .order('created_at', { ascending: false })
    .limit(1000)
  return (data as AdEventRow[]) ?? []
}

/** Log an ad impression/click. Anonymous visitors log a row without a user_id. */
export async function logAdEvent(userId: string | null, adId: string, eventType: AdEventType): Promise<void> {
  await supabase.from('ad_events').insert({ user_id: userId, ad_id: adId, event_type: eventType })
}

/* -------------------------------- withdrawals ------------------------------ */

export async function fetchMyWithdrawals(userId: string): Promise<WithdrawalRow[]> {
  const { data } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return (data as WithdrawalRow[]) ?? []
}

export async function fetchAllWithdrawals(): Promise<WithdrawalRow[]> {
  const { data } = await supabase
    .from('withdrawals')
    .select('*')
    .order('created_at', { ascending: false })
  return (data as WithdrawalRow[]) ?? []
}

export async function requestWithdrawal(input: {
  userId: string
  amount: number
  method: string
  walletAddress: string
  methodDetail?: string
  accountHolder?: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('withdrawals').insert({
    user_id: input.userId,
    amount: input.amount,
    method: input.method,
    wallet_address: input.walletAddress.trim(),
    method_detail: input.methodDetail?.trim() || null,
    account_holder: input.accountHolder?.trim() || null,
    status: 'pending',
  })
  return { error: error?.message ?? null }
}

/** How much this user can withdraw right now (paid commissions − open requests). */
export async function fetchWithdrawableBalance(userId: string): Promise<number> {
  const { data } = await supabase.rpc('withdrawable_balance', { uid: userId })
  return Number(data ?? 0)
}

export async function setWithdrawalStatus(
  id: string,
  status: WithdrawalStatus,
): Promise<string | null> {
  const { error } = await supabase
    .from('withdrawals')
    .update({ status, processed_at: new Date().toISOString() })
    .eq('id', id)
  return error?.message ?? null
}

/* ---------------------------------- brokers -------------------------------- */

export async function fetchBrokers(): Promise<BrokerRow[]> {
  const { data } = await supabase
    .from('brokers')
    .select('*')
    .order('sort', { ascending: true })
  return (data as BrokerRow[]) ?? []
}

export async function saveBroker(broker: Partial<BrokerRow> & { name: string; slug: string }): Promise<string | null> {
  const { error } = await supabase.from('brokers').upsert(broker)
  return error?.message ?? null
}

export async function deleteBroker(id: string): Promise<string | null> {
  const { error } = await supabase.from('brokers').delete().eq('id', id)
  return error?.message ?? null
}

export async function fetchMyConnections(userId: string): Promise<BrokerConnectionRow[]> {
  // Never SELECT the stored credential (api_key = MT password / OANDA token)
  // into the browser — it is only ever read server-side by the broker edge
  // functions. The column stays in the row type for internal typing only.
  const { data } = await supabase
    .from('broker_connections')
    .select('id, user_id, broker_id, account_id, account_type, platform, server, robot_number, status, last_verified_at, created_at, brokers(*)')
    .eq('user_id', userId)
  // supabase-js types the joined sub-select loosely; the shape matches
  // BrokerConnectionRow (credential intentionally omitted from the select).
  return (data as unknown as BrokerConnectionRow[]) ?? []
}

export async function saveConnection(input: {
  userId: string
  brokerId: string
  apiKey: string
  accountId?: string
  accountType: 'practice' | 'live'
  platform?: 'oanda' | 'mt4' | 'mt5'
  server?: string
  robotNumber?: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('broker_connections').upsert(
    {
      user_id: input.userId,
      broker_id: input.brokerId,
      api_key: input.apiKey.trim(),
      account_id: input.accountId?.trim() || null,
      account_type: input.accountType,
      platform: input.platform ?? 'oanda',
      server: input.server?.trim() || null,
      robot_number: input.robotNumber ?? 1,
      status: 'connected',
      last_verified_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,broker_id,robot_number' },
  )
  if (error) {
    // 23505 = unique violation → the same MT4/MT5 account is already connected.
    if (error.code === '23505') {
      return { error: 'That MetaTrader account is already connected on this platform. Disconnect it from its current slot first.' }
    }
    return { error: error.message }
  }
  return { error: null }
}

export async function removeConnection(id: string): Promise<string | null> {
  const { error } = await supabase.from('broker_connections').delete().eq('id', id)
  return error?.message ?? null
}

/**
 * Load the robot ↔ trading-account link matrix. A link binds one robot slot
 * to one broker connection; a robot may control several accounts and several
 * robots may share one account (multi-robot / multi-account).
 */
export async function fetchRobotAccountLinks(userId: string): Promise<RobotAccountLinkRow[]> {
  const { data } = await supabase
    .from('robot_account_links')
    .select('id, user_id, robot_number, connection_id, created_at')
    .eq('user_id', userId)
  return (data as unknown as RobotAccountLinkRow[]) ?? []
}

/** Replace the user's whole robot ↔ account link matrix in one transaction. */
export async function saveRobotAccountLinks(
  userId: string,
  links: { robot_number: number; connection_id: string }[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('replace_robot_account_links', {
    p_user_id: userId,
    p_links: links,
  })
  return { error: error?.message ?? null }
}

/** Read the masked status of the auto-generated REST API token (never the raw value). */
export async function fetchBrokerTokenStatus(connectionId?: string): Promise<BrokerTokenStatus | null> {
  const { data } = await fn<BrokerTokenStatus>('broker-token', {
    body: { action: 'status', connection_id: connectionId },
    fallback: 'Could not check the REST API token.',
  })
  return data
}

/** (Re)generate the REST API token for a connection; returns the masked preview. */
export async function generateBrokerToken(connectionId: string): Promise<{ data: BrokerTokenStatus | null; error: string | null }> {
  return fn<BrokerTokenStatus>('broker-token', {
    body: { action: 'generate', connectionId },
    fallback: 'Could not generate the REST API token.',
  })
}

/** Revoke the auto-generated REST API token for the active connection. */
export async function revokeBrokerToken(connectionId?: string): Promise<{ data: BrokerTokenStatus | null; error: string | null }> {
  return fn<BrokerTokenStatus>('broker-token', {
    body: { action: 'revoke', connection_id: connectionId },
    fallback: 'Could not revoke the REST API token.',
  })
}

/* --------------------------------- settings -------------------------------- */

export async function fetchSettings(): Promise<SettingsRow[]> {
  const { data } = await supabase.from('settings').select('*')
  return (data as SettingsRow[]) ?? []
}

export async function saveSetting(key: string, value: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return error?.message ?? null
}

/* ------------------------------ market data -------------------------------- */

export interface MarketDataProviderOption {
  id: string
  label: string
  configured: boolean
  /** True when this source needs no API key (free or broker-derived). */
  keyless?: boolean
  /** Where the data comes from: keyed API, free keyless source, or a broker trader account. */
  source?: 'keyed' | 'keyless' | 'broker'
}

export interface MarketDataConfig {
  provider: string
  provider_label: string
  configured: boolean
  providers: MarketDataProviderOption[]
  /** The provider actually serving data right now (after automatic fallback). */
  active_provider?: string | null
  active_provider_label?: string | null
  fallback_available?: boolean
}

/** Shape the raw Edge Function response into the typed config object. */
function normalizeMarketDataConfig(data: unknown): MarketDataConfig | null {
  if (!data || typeof data !== 'object' || 'error' in (data as object)) return null
  const cfg = data as Partial<MarketDataConfig>
  return {
    provider: cfg.provider ?? 'twelvedata',
    provider_label: cfg.provider_label ?? 'Twelve Data',
    configured: Boolean(cfg.configured),
    providers: Array.isArray(cfg.providers) && cfg.providers.length > 0 ? cfg.providers : [],
    active_provider: cfg.active_provider ?? null,
    active_provider_label: cfg.active_provider_label ?? null,
    fallback_available: Boolean(cfg.fallback_available),
  }
}

/** Read which market-data provider is configured (never the key itself). */
export async function fetchMarketDataConfig(): Promise<MarketDataConfig | null> {
  const { data, error } = await supabase.functions.invoke('market-data', { body: { action: 'market_config' } })
  if (error) return null
  return normalizeMarketDataConfig(data)
}

/**
 * Admin: validate and store a market-data provider API key. The key is saved
 * server-side (app_secrets, service-role only) and never exposed to the
 * browser. It also becomes the active provider for quotes/time-series. Returns
 * null on success, otherwise an error message.
 */
export async function updateMarketDataApiKey(apiKey: string, provider = 'twelvedata'): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('market-data', {
    body: { action: 'set_api_key', api_key: apiKey, provider },
  })
  if (error) return error.message ?? 'Could not update the API key.'
  if (data && typeof data === 'object' && 'error' in (data as object)) {
    const msg = (data as { message?: string }).message
    return msg ?? 'The provider rejected that key.'
  }
  return null
}

/**
 * Admin: disconnect a market-data provider — removes its stored API key
 * server-side so quotes/time-series stop using it. Returns null on success,
 * otherwise an error message.
 */
export async function disconnectMarketData(provider = 'twelvedata'): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('market-data', {
    body: { action: 'disconnect', provider },
  })
  if (error) return error.message ?? 'Could not disconnect the provider.'
  if (data && typeof data === 'object' && 'error' in (data as object)) {
    const msg = (data as { message?: string }).message
    return msg ?? 'Could not disconnect the provider.'
  }
  return null
}

/**
 * Admin: generate a market-data source from the admin's connected OANDA broker
 * trader account (no API key needed — data is fetched through the broker). This
 * makes the broker the selected provider and persists it server-side. Returns
 * null on success, otherwise an error message.
 */
export async function provisionMarketDataFromBroker(broker: 'oanda' = 'oanda'): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('market-data', {
    body: { action: 'set_broker_source', broker },
  })
  if (error) return error.message ?? 'Could not set up the broker market data source.'
  if (data && typeof data === 'object' && 'error' in (data as object)) {
    const msg = (data as { message?: string }).message
    return msg ?? 'Could not set up the broker market data source.'
  }
  return null
}

/**
 * One-click "get free market data" (any signed-in user, from the Configuration
 * page): switches the platform to the built-in keyless source — Binance public
 * API for crypto + Yahoo Finance for FX. No signup, no API key, $0 forever. It
 * never overrides a provider that already has a stored API key (the free source
 * stays the automatic fallback then).
 */
export async function activateFreeMarketData(): Promise<{
  error: string | null
  message?: string
  config: MarketDataConfig | null
}> {
  const { data, error } = await supabase.functions.invoke('market-data', { body: { action: 'activate_free' } })
  if (error) return { error: error.message ?? 'Could not enable free market data.', config: null }
  if (data && typeof data === 'object' && 'error' in (data as object)) {
    const msg = (data as { message?: string }).message
    return { error: msg ?? 'Could not enable free market data.', config: null }
  }
  const payload = data as { message?: string } | null
  return {
    error: null,
    message: typeof payload?.message === 'string' ? payload.message : undefined,
    config: normalizeMarketDataConfig(data),
  }
}

/** Convenience: read a setting's value object (or a raw default). */
export function settingValue(settings: SettingsRow[], key: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return settings.find((s) => s.key === key)?.value ?? fallback
}

/* ----------------------------- contact settings ---------------------------- */

/** Contact details shown on the public Contact page (single row, id = 1). */
export async function fetchContactSettings(): Promise<ContactSettings | null> {
  const { data } = await supabase.from('contact_settings').select('*').eq('id', 1).maybeSingle()
  return (data as ContactSettings | null) ?? null
}

/** Admin updates the email / WhatsApp / phone shown on the Contact page. */
export async function saveContactSettings(input: Pick<ContactSettings, 'email' | 'whatsapp' | 'phone'>): Promise<string | null> {
  const { error } = await supabase
    .from('contact_settings')
    .upsert({ id: 1, ...input, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  return error?.message ?? null
}

/* ---------------------------- withdrawal accounts -------------------------- */

/** The user's saved payout accounts (set once on the Withdraw-account page). */
export async function fetchMyWithdrawalAccounts(userId: string): Promise<WithdrawalAccountRow[]> {
  const { data } = await supabase
    .from('withdrawal_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  return (data as WithdrawalAccountRow[]) ?? []
}

/** Every user's saved payout accounts, oldest first (admin only — RLS enforces it). */
export async function fetchAllWithdrawalAccounts(): Promise<WithdrawalAccountRow[]> {
  const { data } = await supabase
    .from('withdrawal_accounts')
    .select('*')
    .order('created_at', { ascending: true })
  return (data as WithdrawalAccountRow[]) ?? []
}

export async function saveWithdrawalAccount(input: {
  userId: string
  method: WithdrawalMethod
  label: string
  details: Record<string, string>
  isDefault?: boolean
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('withdrawal_accounts').insert({
    user_id: input.userId,
    method: input.method,
    label: input.label.trim(),
    details: input.details,
    is_default: input.isDefault ?? true,
  })
  return { error: error?.message ?? null }
}

export async function deleteWithdrawalAccount(id: string): Promise<string | null> {
  const { error } = await supabase.from('withdrawal_accounts').delete().eq('id', id)
  return error?.message ?? null
}

/* ------------------------------ payment accounts --------------------------- */

/** Admin-managed receiving accounts shown on the Packages page. */
export async function fetchPaymentAccounts(): Promise<PaymentAccountRow[]> {
  const { data } = await supabase.from('payment_accounts').select('*').order('sort', { ascending: true })
  return (data as PaymentAccountRow[]) ?? []
}

export async function savePaymentAccount(
  acc: Partial<PaymentAccountRow> & { method: PaymentMethod; label: string },
): Promise<string | null> {
  const { error } = await supabase.from('payment_accounts').upsert(acc)
  return error?.message ?? null
}

export async function deletePaymentAccount(id: string): Promise<string | null> {
  const { error } = await supabase.from('payment_accounts').delete().eq('id', id)
  return error?.message ?? null
}

/* -------------------------------- notifications ---------------------------- */

/** Notifications visible to the signed-in user (own + admin broadcasts). */
export async function fetchNotifications(limit = 100): Promise<NotificationRow[]> {
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit)
  return (data as NotificationRow[]) ?? []
}

/** Only unread notifications (for the bell badge). */
export async function fetchUnreadNotifications(): Promise<NotificationRow[]> {
  const { data } = await supabase.from('notifications').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(50)
  return (data as NotificationRow[]) ?? []
}

export async function unreadNotificationsCount(): Promise<number> {
  const { data } = await supabase.rpc('unread_notifications_count')
  return Number(data ?? 0)
}

export async function markNotificationsRead(): Promise<void> {
  await supabase.rpc('mark_notifications_read')
}

/** Raise a notification for all admins (from any signed-in user's action). */
export async function notifyAdmin(type: NotificationType, title: string, body?: string, link?: string): Promise<void> {
  await supabase.rpc('create_notification', {
    p_user_id: null,
    p_type: type,
    p_title: title,
    p_body: body ?? null,
    p_link: link ?? null,
  })
}

/** Raise a notification for a specific user (from an admin action). */
export async function notifyUser(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
  link?: string,
): Promise<void> {
  await supabase.rpc('create_notification', {
    p_user_id: userId,
    p_type: type,
    p_title: title,
    p_body: body ?? null,
    p_link: link ?? null,
  })
}