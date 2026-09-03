/**
 * React hooks over the v2.0 platform data layer (profiles, packages,
 * subscriptions, referrals, ads, brokers, settings, notifications). Each hook
 * owns its fetch state and exposes a `refresh` so pages can re-sync after a
 * mutation. All reads go through RLS-protected Supabase queries.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './useAuth'
import {
  fetchAddons,
  fetchAds,
  fetchAllAddonPurchases,
  fetchAllReferrals,
  fetchAllSubscriptions,
  fetchAllWithdrawalAccounts,
  fetchAllWithdrawals,
  fetchBrokers,
  fetchContactSettings,
  fetchDownline,
  fetchMyAddonPurchases,
  fetchMyAdEvents,
  fetchMyAds,
  fetchMyConnections,
  fetchMySubscriptions,
  fetchMyWithdrawals,
  fetchNotifications,
  fetchPackages,
  fetchPaymentAccounts,
  fetchProfile,
  fetchPublicUserStats,
  fetchSettings,
  fetchUnreadNotifications,
  listUsers,
  markNotificationsRead,
} from '../lib/platform'
import type {
  AddonPurchaseRow,
  AddonRow,
  AdEventRow,
  AdRow,
  BrokerConnectionRow,
  BrokerRow,
  ContactSettings,
  NotificationRow,
  PackageRow,
  PaymentAccountRow,
  Profile,
  PublicUserStats,
  ReferralRow,
  SettingsRow,
  SubscriptionRow,
  WithdrawalAccountRow,
  WithdrawalRow,
} from '../lib/types'

/* -------------------------------- profile --------------------------------- */

export function useProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setProfile(await fetchProfile(user.id))
    setLoading(false)
  }, [user?.id])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { profile, loading, refresh }
}

/* ------------------------------ subscriptions ----------------------------- */

export function useSubscriptions(userId?: string) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const refresh = useCallback(async () => {
    if (!userId) {
      setSubscriptions([])
      return
    }
    setSubscriptions(await fetchMySubscriptions(userId))
  }, [userId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { subscriptions, refresh }
}

export function useAllSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const refresh = useCallback(async () => {
    setSubscriptions(await fetchAllSubscriptions())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { subscriptions, refresh }
}

/* -------------------------------- add-ons --------------------------------- */

export function useAddons() {
  const [addons, setAddons] = useState<AddonRow[]>([])
  const refresh = useCallback(async () => {
    setAddons(await fetchAddons())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { addons, refresh }
}

export function useAddonPurchases(userId?: string) {
  const [purchases, setPurchases] = useState<AddonPurchaseRow[]>([])
  const refresh = useCallback(async () => {
    if (!userId) {
      setPurchases([])
      return
    }
    setPurchases(await fetchMyAddonPurchases(userId))
  }, [userId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { purchases, refresh }
}

export function useAllAddonPurchases() {
  const [purchases, setPurchases] = useState<AddonPurchaseRow[]>([])
  const refresh = useCallback(async () => {
    setPurchases(await fetchAllAddonPurchases())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { purchases, refresh }
}

/* -------------------------------- referrals ------------------------------- */

export function useDownline(userId?: string) {
  const [referrals, setReferrals] = useState<ReferralRow[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    if (!userId) {
      setReferrals([])
      setLoading(false)
      return
    }
    setLoading(true)
    setReferrals(await fetchDownline(userId))
    setLoading(false)
  }, [userId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { referrals, loading, refresh }
}

export function useAllReferrals() {
  const [referrals, setReferrals] = useState<ReferralRow[]>([])
  const refresh = useCallback(async () => {
    setReferrals(await fetchAllReferrals())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { referrals, refresh }
}

/* ---------------------------------- ads ----------------------------------- */

export function useAds() {
  const [ads, setAds] = useState<AdRow[]>([])
  const refresh = useCallback(async () => {
    setAds(await fetchAds())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { ads, refresh }
}

export function useMyAds(userId?: string) {
  const [ads, setAds] = useState<AdRow[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    if (!userId) {
      setAds([])
      setLoading(false)
      return
    }
    setLoading(true)
    setAds(await fetchMyAds(userId))
    setLoading(false)
  }, [userId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { ads, loading, refresh }
}

export function useAdEvents(userId?: string) {
  const [events, setEvents] = useState<AdEventRow[]>([])
  const refresh = useCallback(async () => {
    if (!userId) {
      setEvents([])
      return
    }
    setEvents(await fetchMyAdEvents(userId))
  }, [userId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { events, refresh }
}

/* ------------------------------- withdrawals ------------------------------ */

export function useWithdrawals(userId?: string) {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    if (!userId) {
      setWithdrawals([])
      setLoading(false)
      return
    }
    setLoading(true)
    setWithdrawals(await fetchMyWithdrawals(userId))
    setLoading(false)
  }, [userId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { withdrawals, loading, refresh }
}

/** Every user's withdrawal requests, newest first (admin only — RLS enforces it). */
export function useAllWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const refresh = useCallback(async () => {
    setWithdrawals(await fetchAllWithdrawals())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { withdrawals, refresh }
}

/** Every user's saved payout accounts, oldest first (admin only — RLS enforces it). */
export function useAllWithdrawalAccounts() {
  const [accounts, setAccounts] = useState<WithdrawalAccountRow[]>([])
  const refresh = useCallback(async () => {
    setAccounts(await fetchAllWithdrawalAccounts())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { accounts, refresh }
}

/* -------------------------------- brokers --------------------------------- */

export function useBrokers(userId?: string) {
  const [brokers, setBrokers] = useState<BrokerRow[]>([])
  const [connections, setConnections] = useState<BrokerConnectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    setLoading(true)
    setBrokers(await fetchBrokers())
    if (userId) setConnections(await fetchMyConnections(userId))
    else setConnections([])
    setLoading(false)
  }, [userId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { brokers, connections, loading, refresh }
}

/* -------------------------------- settings -------------------------------- */

export function useSettings() {
  const [settings, setSettings] = useState<SettingsRow[]>([])
  const refresh = useCallback(async () => {
    setSettings(await fetchSettings())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { settings, refresh }
}

export function useContactSettings() {
  const [contact, setContact] = useState<ContactSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    setLoading(true)
    setContact(await fetchContactSettings())
    setLoading(false)
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { contact, loading, refresh }
}

/* ------------------------------- packages --------------------------------- */

export function usePackages() {
  const [packages, setPackages] = useState<PackageRow[]>([])
  const refresh = useCallback(async () => {
    setPackages(await fetchPackages())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { packages, refresh }
}

export function usePaymentAccounts() {
  const [accounts, setAccounts] = useState<PaymentAccountRow[]>([])
  const refresh = useCallback(async () => {
    setAccounts(await fetchPaymentAccounts())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { accounts, refresh }
}

/* ------------------------------ admin helpers ----------------------------- */

export function useAdminUsers() {
  const [users, setUsers] = useState<Profile[]>([])
  const refresh = useCallback(async () => {
    setUsers(await listUsers())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { users, refresh }
}

/* ----------------------------- notifications ------------------------------ */

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [all, unreadRows] = await Promise.all([fetchNotifications(100), fetchUnreadNotifications()])
    setNotifications(all)
    setUnread(unreadRows.length)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const markAllRead = useCallback(async () => {
    await markNotificationsRead()
    setUnread(0)
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
  }, [])

  return { notifications, unread, loading, refresh, markAllRead }
}

/* --------------------------- public user stats ---------------------------- */

export function usePublicUserStats() {
  const [stats, setStats] = useState<PublicUserStats>({ registered: 0, active_24h: 0, active_7d: 0, active_30d: 0 })
  useEffect(() => {
    let active = true
    void fetchPublicUserStats().then((s) => {
      if (active) setStats(s)
    })
    return () => {
      active = false
    }
  }, [])
  return { stats }
}

/* --------------------------------- access -------------------------------- */

export type AccessStatus = 'admin' | 'active' | 'trial' | 'expired' | 'none'

export interface AccessInfo {
  status: AccessStatus
  /** True when the robot can auto-trade (admin, active sub, or active trial). */
  hasAccess: boolean
  /** True when paper/manual trading is unlocked. */
  paperTrading: boolean
}

/** Derive the user's access state from their profile + subscriptions. */
export function useAccess(
  profile: Profile | null,
  subscriptions: SubscriptionRow[],
  _purchases?: AddonPurchaseRow[],
): AccessInfo {
  return useMemo(() => {
    const now = Date.now()
    const activeSub = subscriptions.some(
      (s) => s.status === 'active' && (!s.ends_at || new Date(s.ends_at).getTime() > now),
    )
    const trial = profile?.trial_ends_at != null && new Date(profile.trial_ends_at).getTime() > now
    const admin = profile?.role === 'admin'

    let status: AccessStatus = 'none'
    if (admin) status = 'admin'
    else if (activeSub) status = 'active'
    else if (trial) status = 'trial'
    else if (subscriptions.length > 0) status = 'expired'

    return { status, hasAccess: admin || activeSub || trial, paperTrading: admin || activeSub || trial }
  }, [profile, subscriptions])
}
