import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3,
  Check,
  CreditCard,
  DollarSign,
  Gauge,
  KeyRound,
  Landmark,
  Layers,
  LayoutGrid,
  Megaphone,
  Package,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Unplug,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  useAdminUsers,
  useAddons,
  useAllAddonPurchases,
  useAllReferrals,
  useAllSubscriptions,
  useAllWithdrawalAccounts,
  useAllWithdrawals,
  useAds,
  useBrokers,
  useContactSettings,
  usePackages,
  usePaymentAccounts,
  useProfile,
  useSettings,
} from '../hooks/usePlatform'
import {
  deleteAd,
  deleteAddon,
  deleteBroker,
  deletePackage,
  deletePaymentAccount,
  notifyUser,
  reviewAd,
  reviewIdentity,
  saveAd,
  saveAddon,
  saveBroker,
  saveContactSettings,
  savePackage,
  savePaymentAccount,
  saveSetting,
  setAddonPurchaseStatus,
  setReferralStatus,
  setSubscriptionStatus,
  setUserRole,
  setWithdrawalStatus,
  fetchMarketDataConfig,
  updateMarketDataApiKey,
  disconnectMarketData,
  provisionMarketDataFromBroker,
  activateFreeMarketData,
} from '../lib/platform'
import { PAYMENT_METHOD_LABEL } from '../lib/paymentMethods'
import type {
  AddonRow,
  AdRow,
  BrokerPlatform,
  BrokerRow,
  PackageRow,
  PaymentAccountRow,
  PaymentMethod,
  WithdrawalAccountRow,
} from '../lib/types'
import { settingValue } from '../lib/platform'
import { cn } from '../lib/cn'
import { formatDateTime, formatUsd } from '../lib/format'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Select } from '../components/ui'

type Tab = 'overview' | 'users' | 'subscriptions' | 'addons' | 'packages' | 'ads' | 'brokers' | 'commissions' | 'withdrawals' | 'identity' | 'payments' | 'settings'

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'subscriptions', label: 'Subscriptions', icon: DollarSign },
  { id: 'addons', label: 'Add-ons', icon: Layers },
  { id: 'packages', label: 'Packages', icon: Package },
  { id: 'ads', label: 'Ads', icon: Megaphone },
  { id: 'brokers', label: 'Brokers', icon: LayoutGrid },
  { id: 'commissions', label: 'Commissions', icon: Gauge },
  { id: 'withdrawals', label: 'Withdrawals', icon: Landmark },
  { id: 'identity', label: 'Identity', icon: ShieldCheck },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

const SUB_STATUS: Record<string, string> = {
  pending: 'border-amber/40 bg-amber/10 text-amber',
  active: 'border-up/40 bg-up/10 text-up',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
  expired: 'border-border bg-muted text-muted-foreground',
}

export function Admin() {
  const { user } = useAuth()
  const { profile, loading: profileLoading } = useProfile()
  const [tab, setTab] = useState<Tab>('overview')

  if (profileLoading) return <div className="h-24 animate-pulse rounded-xl bg-muted" />

  if (!user || profile?.role !== 'admin') {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6" aria-hidden="true" />}
        title="Admins only"
        message="This dashboard manages users, subscriptions, packages, ads, brokers and settings. Your account isn't an admin."
        action={
          <Link to="/">
            <Button>Back to dashboard</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight">Admin dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage users, approve subscriptions, edit packages, ads, brokers and platform settings.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-secondary/40 p-1" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150',
                tab === t.id ? 'bg-accent text-black' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'subscriptions' && <SubscriptionsTab />}
      {tab === 'addons' && <AddonsTab />}
      {tab === 'packages' && <PackagesTab />}
      {tab === 'ads' && <AdsTab />}
      {tab === 'brokers' && <BrokersTab />}
      {tab === 'commissions' && <CommissionsTab />}
      {tab === 'withdrawals' && <WithdrawalsTab />}
      {tab === 'identity' && <IdentityTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

/* --------------------------------- Overview -------------------------------- */

function OverviewTab() {
  const { users } = useAdminUsers()
  const { subscriptions } = useAllSubscriptions()
  const { referrals } = useAllReferrals()
  const { withdrawals } = useAllWithdrawals()
  const { packages } = usePackages()
  const { ads } = useAds()
  const { settings } = useSettings()

  const pending = subscriptions.filter((s) => s.status === 'pending').length
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending').length
  const trial = settingValue(settings, 'trial', { trial_minutes: 30 })
  const stats = [
    { label: 'Users', value: users.length },
    { label: 'Admins', value: users.filter((u) => u.role === 'admin').length },
    { label: 'Pending approvals', value: pending },
    { label: 'Active subscriptions', value: subscriptions.filter((s) => s.status === 'active').length },
    { label: 'Referrals', value: referrals.length },
    { label: 'Pending withdrawals', value: pendingWithdrawals },
    { label: 'Packages', value: packages.length },
    { label: 'Live ads', value: ads.filter((a) => a.active).length },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>At a glance</CardTitle>
        <Badge className="border-border bg-muted text-muted-foreground">
          Free trial: {String(trial.trial_minutes)} min
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-secondary/60 p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-bold tnum">{s.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ----------------------------------- Users ---------------------------------- */

/** One-line summary of a saved payout account's details. */
function payoutAccountDetail(acc: WithdrawalAccountRow): string {
  const parts = Object.values(acc.details ?? {}).filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return parts.length ? parts.join(' · ') : '—'
}

function UsersTab() {
  const { users, refresh } = useAdminUsers()
  const { accounts: payoutAccounts } = useAllWithdrawalAccounts()
  const [msg, setMsg] = useState<string | null>(null)

  const accountsByUser = useMemo(() => {
    const map = new Map<string, WithdrawalAccountRow[]>()
    for (const a of payoutAccounts) {
      const list = map.get(a.user_id) ?? []
      list.push(a)
      map.set(a.user_id, list)
    }
    return map
  }, [payoutAccounts])

  const toggleAdmin = async (id: string, current: string) => {
    setMsg(null)
    const err = await setUserRole(id, current === 'admin' ? 'user' : 'admin')
    if (err) setMsg(err)
    else await refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <Badge className="border-border bg-muted text-muted-foreground">{users.length} total</Badge>
      </CardHeader>
      <CardContent>
        {msg && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Real name</th>
                <th className="py-2 pr-4 font-medium">Payout account</th>
                <th className="py-2 pr-4 font-medium">Referral</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Trial ends</th>
                <th className="py-2 pr-4 font-medium">Earned</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const accounts = accountsByUser.get(u.id) ?? []
                return (
                  <tr key={u.id} className="align-top border-b border-border/60 last:border-0">
                    <td className="max-w-[180px] truncate py-2 pr-4 font-medium">{u.email ?? u.display_name ?? '—'}</td>
                    <td className="py-2 pr-4">{u.real_name ?? '—'}</td>
                    <td className="max-w-[240px] py-2 pr-4">
                      {accounts.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-1">
                          {accounts.map((a) => (
                            <div key={a.id} className="truncate text-xs" title={payoutAccountDetail(a)}>
                              <span className="uppercase text-muted-foreground">{a.method}</span>
                              <span className="ml-1 font-medium">{a.label || 'Payout'}</span>
                              <span className="ml-1 text-muted-foreground">· {payoutAccountDetail(a)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{u.referral_code}</td>
                    <td className="py-2 pr-4">
                      <Badge className={u.role === 'admin' ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border bg-muted text-muted-foreground'}>
                        {u.role}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(u.trial_ends_at)}</td>
                    <td className="py-2 pr-4 tnum">{formatUsd(u.commission_earned)}</td>
                    <td className="py-2">
                      <Button variant="secondary" size="sm" onClick={() => void toggleAdmin(u.id, u.role)}>
                        {u.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------- Subscriptions ------------------------------ */

function SubscriptionsTab() {
  const { subscriptions, refresh } = useAllSubscriptions()
  const { users } = useAdminUsers()
  const [msg, setMsg] = useState<string | null>(null)

  const emailOf = (id: string) => users.find((u) => u.id === id)?.email ?? '—'

  const setStatus = async (id: string, status: 'active' | 'rejected') => {
    setMsg(null)
    const sub = subscriptions.find((s) => s.id === id)
    const err = await setSubscriptionStatus(id, status)
    if (err) setMsg(err)
    else {
      await refresh()
      if (sub) {
        await notifyUser(
          sub.user_id,
          status === 'active' ? 'success' : 'error',
          status === 'active' ? 'Subscription activated' : 'Subscription rejected',
          `${sub.packages?.name ?? 'Package'} — ${status === 'active' ? 'you now have full robot access.' : 'your payment request was not approved.'}`,
          '/account?tab=history',
        )
      }
    }
  }

  const pending = subscriptions.filter((s) => s.status === 'pending').length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscriptions</CardTitle>
        <Badge className="border-amber/40 bg-amber/10 text-amber">{pending} pending</Badge>
      </CardHeader>
      <CardContent>
        {msg && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Package</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Tx ref</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Requested</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="max-w-[180px] truncate py-2 pr-4 font-medium">{emailOf(s.user_id)}</td>
                  <td className="py-2 pr-4">{s.packages?.name ?? '—'}</td>
                  <td className="py-2 pr-4 tnum">
                    {s.amount} {s.packages?.currency ?? ''}
                  </td>
                  <td className="max-w-[140px] truncate py-2 pr-4 font-mono text-xs text-muted-foreground">{s.tx_ref ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <Badge className={SUB_STATUS[s.status]}>{s.status}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(s.created_at)}</td>
                  <td className="py-2">
                    {s.status === 'pending' ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => void setStatus(s.id, 'active')}>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void setStatus(s.id, 'rejected')}>
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/* ----------------------------------- Add-ons -------------------------------- */

const ADDON_STATUS: Record<string, string> = {
  pending: 'border-amber/40 bg-amber/10 text-amber',
  active: 'border-up/40 bg-up/10 text-up',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
}

function AddonsTab() {
  const { addons, refresh: refreshAddons } = useAddons()
  const { purchases, refresh: refreshPurchases } = useAllAddonPurchases()
  const { users } = useAdminUsers()
  const [editing, setEditing] = useState<Partial<AddonRow> | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const emailOf = (id: string) => users.find((u) => u.id === id)?.email ?? '—'

  const startNew = () =>
    setEditing({ name: '', description: '', kind: 'robot', amount: 1, price: 0, currency: 'USDT', duration_days: 30, active: true, sort: 99 })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing?.name) return
    setMsg(null)
    const err = await saveAddon({
      id: editing.id,
      name: editing.name,
      description: editing.description ?? '',
      kind: editing.kind ?? 'robot',
      amount: Number(editing.amount) || 1,
      price: Number(editing.price) || 0,
      currency: editing.currency ?? 'USDT',
      duration_days: Number(editing.duration_days) || 30,
      active: editing.active ?? true,
      sort: Number(editing.sort) || 0,
    })
    if (err) setMsg(err)
    else {
      setEditing(null)
      await refreshAddons()
    }
  }

  const remove = async (id: string) => {
    setMsg(null)
    const err = await deleteAddon(id)
    if (err) setMsg(err)
    else await refreshAddons()
  }

  const approve = async (id: string, status: 'active' | 'rejected') => {
    setMsg(null)
    const purchase = purchases.find((p) => p.id === id)
    const err = await setAddonPurchaseStatus(id, status)
    if (err) setMsg(err)
    else {
      await refreshPurchases()
      if (purchase) {
        await notifyUser(
          purchase.user_id,
          status === 'active' ? 'success' : 'error',
          status === 'active' ? 'Add-on activated' : 'Add-on purchase rejected',
          `${purchase.addons?.name ?? 'Add-on'} — ${status === 'active' ? `your extra slot(s) are now live (+${purchase.addons?.amount ?? 0}).` : 'your purchase request was not approved.'}`,
          '/packages',
        )
      }
    }
  }

  const pending = purchases.filter((p) => p.status === 'pending').length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add-on purchases</CardTitle>
          <Badge className="border-amber/40 bg-amber/10 text-amber">{pending} pending</Badge>
        </CardHeader>
        <CardContent>
          {msg && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}
          {purchases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No add-on purchases yet. Users buy extra robot/MT4/5 slots from the Packages page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">User</th>
                    <th className="py-2 pr-4 font-medium">Add-on</th>
                    <th className="py-2 pr-4 font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Tx ref</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Requested</th>
                    <th className="py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id} className="border-b border-border/60 last:border-0">
                      <td className="max-w-[180px] truncate py-2 pr-4 font-medium">{emailOf(p.user_id)}</td>
                      <td className="py-2 pr-4">{p.addons?.name ?? '—'}</td>
                      <td className="py-2 pr-4 tnum">
                        {p.amount} {p.currency}
                      </td>
                      <td className="max-w-[140px] truncate py-2 pr-4 font-mono text-xs text-muted-foreground">{p.tx_ref ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <Badge className={ADDON_STATUS[p.status]}>{p.status}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(p.created_at)}</td>
                      <td className="py-2">
                        {p.status === 'pending' ? (
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => void approve(p.id, 'active')}>
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              Approve
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => void approve(p.id, 'rejected')}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{formatDateTime(p.activated_at)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={startNew}>
          + New add-on
        </Button>
      </div>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? 'Edit add-on' : 'New add-on'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              <Select label="Kind" value={editing.kind ?? 'robot'} onChange={(e) => setEditing({ ...editing, kind: e.target.value as AddonRow['kind'] })}>
                <option value="robot">Robot slot</option>
                <option value="mt_account">MT4/5 account</option>
              </Select>
              <Input
                label="Slots granted (amount)"
                type="number"
                min={1}
                value={editing.amount ?? 1}
                onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
              />
              <Input
                label="Price"
                type="number"
                min={0}
                step="0.01"
                value={editing.price ?? 0}
                onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
              />
              <Input
                label="Currency"
                value={editing.currency ?? 'USDT'}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
              />
              <Input
                label="Duration (days)"
                type="number"
                min={1}
                value={editing.duration_days ?? 30}
                onChange={(e) => setEditing({ ...editing, duration_days: Number(e.target.value) })}
              />
              <Input
                label="Sort order"
                type="number"
                value={editing.sort ?? 0}
                onChange={(e) => setEditing({ ...editing, sort: Number(e.target.value) })}
              />
              <div className="sm:col-span-2">
                <Input
                  label="Description"
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div className="flex items-end gap-3 pb-1 sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={editing.active ?? true}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                    className="h-4 w-4 cursor-pointer accent-emerald-500"
                  />
                  Active
                </label>
                <div className="ml-auto flex gap-2">
                  <Button type="submit" size="sm">Save</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <div className="space-y-2">
            {addons.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No add-ons yet — add one so users can buy extra slots.</p>
            ) : (
              addons.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {a.name}{' '}
                      <Badge className="border-accent/40 bg-accent/15 text-accent">
                        +{a.amount} {a.kind === 'robot' ? 'robot' : 'MT4/5'}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.price} {a.currency} · {a.duration_days}d · {a.active ? 'Active' : 'Hidden'} · sort {a.sort}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* --------------------------------- Packages -------------------------------- */

function PackagesTab() {
  const { packages, refresh } = usePackages()
  const [editing, setEditing] = useState<Partial<PackageRow> | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const startNew = () =>
    setEditing({ name: '', description: '', price: 0, currency: 'USDT', duration_days: 30, commission_pct: 10, robots: 1, mt_accounts: 1, features: {}, active: true })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing?.name) return
    setMsg(null)
    const err = await savePackage({
      id: editing.id,
      name: editing.name,
      description: editing.description ?? '',
      price: Number(editing.price) || 0,
      currency: editing.currency ?? 'USDT',
      duration_days: Number(editing.duration_days) || 30,
      commission_pct: Number(editing.commission_pct) || 0,
      robots: Math.max(1, Number(editing.robots) || 1),
      mt_accounts: Math.max(1, Number(editing.mt_accounts) || 1),
      features: editing.features ?? {},
      active: editing.active ?? true,
    })
    if (err) setMsg(err)
    else {
      setEditing(null)
      await refresh()
    }
  }

  const remove = async (id: string) => {
    await deletePackage(id)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={startNew}>
          + New package
        </Button>
      </div>
      {msg && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? 'Edit package' : 'New package'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              <Input
                label="Price"
                type="number"
                min={0}
                step="0.01"
                value={editing.price ?? 0}
                onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
              />
              <Input
                label="Duration (days)"
                type="number"
                min={1}
                value={editing.duration_days ?? 30}
                onChange={(e) => setEditing({ ...editing, duration_days: Number(e.target.value) })}
              />
              <Input
                label="Robot slots"
                type="number"
                min={1}
                value={editing.robots ?? 1}
                onChange={(e) => setEditing({ ...editing, robots: Number(e.target.value) })}
              />
              <Input
                label="MT4/5 account slots"
                type="number"
                min={1}
                value={editing.mt_accounts ?? 1}
                onChange={(e) => setEditing({ ...editing, mt_accounts: Number(e.target.value) })}
              />
              <Input
                label="Commission %"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={editing.commission_pct ?? 0}
                onChange={(e) => setEditing({ ...editing, commission_pct: Number(e.target.value) })}
              />
              <Input
                label="Description"
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
              <div className="flex items-end gap-3 pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={editing.active ?? true}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                    className="h-4 w-4 cursor-pointer accent-emerald-500"
                  />
                  Active
                </label>
                <div className="ml-auto flex gap-2">
                  <Button type="submit" size="sm">Save</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Set how many robot slots and MT4/5 account connections this package unlocks. Extra
                robot/MT4/5 slots are sold separately as add-ons.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {packages.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                <Badge className={p.active ? 'border-up/40 bg-up/10 text-up' : 'border-border bg-muted text-muted-foreground'}>
                  {p.active ? 'Active' : 'Hidden'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {p.price} {p.currency} · {p.duration_days}d · {p.commission_pct}% commission
              </p>
              <p className="text-xs text-muted-foreground">
                {p.robots} robot slot{p.robots !== 1 ? 's' : ''} · {p.mt_accounts} MT4/5 account{p.mt_accounts !== 1 ? 's' : ''}
              </p>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => void remove(p.id)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------ Ads ----------------------------------- */

const AD_STATUS: Record<string, string> = {
  pending: 'border-amber/40 bg-amber/10 text-amber',
  approved: 'border-up/40 bg-up/10 text-up',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
}

function AdsTab() {
  const { ads, refresh } = useAds()
  const { users } = useAdminUsers()
  const [editing, setEditing] = useState<Partial<AdRow> | null>(null)
  const [noteById, setNoteById] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const emailOf = (id?: string | null) => users.find((u) => u.id === id)?.email ?? null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing?.title) return
    setMsg(null)
    const err = await saveAd({
      id: editing.id,
      title: editing.title,
      image_url: editing.image_url ?? null,
      target_url: editing.target_url ?? null,
      placement: editing.placement ?? 'global',
      price: editing.price != null && editing.price !== 0 ? Number(editing.price) : null,
      price_currency: editing.price != null && editing.price !== 0 ? (editing.price_currency ?? 'USD') : null,
      active: editing.active ?? true,
      status: 'approved',
      user_id: null,
    })
    if (err) setMsg(err)
    else {
      setEditing(null)
      await refresh()
    }
  }

  const toggle = async (ad: AdRow) => {
    setMsg(null)
    const err = await saveAd({ ...ad, active: !ad.active })
    if (err) setMsg(err)
    else await refresh()
  }

  const review = async (ad: AdRow, status: 'approved' | 'rejected') => {
    setMsg(null)
    const err = await reviewAd(ad.id, status, noteById[ad.id] ?? '')
    if (err) setMsg(err)
    else {
      await refresh()
      if (ad.user_id) {
        await notifyUser(
          ad.user_id,
          status === 'approved' ? 'success' : 'error',
          status === 'approved' ? 'Ad approved' : 'Ad rejected',
          status === 'approved'
            ? `Your ad “${ad.title}” is now live on the site.`
            : `Your ad “${ad.title}” was not approved${noteById[ad.id] ? ` — ${noteById[ad.id]}` : '.'}`,
          '/my-ads',
        )
      }
    }
  }

  const remove = async (id: string) => {
    setMsg(null)
    const err = await deleteAd(id)
    if (err) setMsg(err)
    else await refresh()
  }

  const pending = ads.filter((a) => a.status === 'pending').length

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing({ title: '', target_url: '', image_url: '', placement: 'global', price: null, price_currency: 'USD', active: true })}>
          + New ad
        </Button>
      </div>
      {msg && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? 'Edit ad' : 'New ad'}</CardTitle>
            <Badge className="border-up/40 bg-up/10 text-up">Approved immediately (platform ad)</Badge>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <Input label="Title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required />
              <Input label="Target URL" value={editing.target_url ?? ''} onChange={(e) => setEditing({ ...editing, target_url: e.target.value })} />
              <Input label="Image URL (optional)" value={editing.image_url ?? ''} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} />
              <Input
                label="Promo price (optional)"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 49"
                value={editing.price ?? ''}
                onChange={(e) => setEditing({ ...editing, price: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <Select
                label="Price currency"
                value={editing.price_currency ?? 'USD'}
                onChange={(e) => setEditing({ ...editing, price_currency: e.target.value })}
                disabled={!editing.price}
              >
                {['USD', 'EUR', 'GBP', 'IDR', 'USDT'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <div className="flex items-end gap-3 pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={editing.active ?? true}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                    className="h-4 w-4 cursor-pointer accent-emerald-500"
                  />
                  Active
                </label>
                <div className="ml-auto flex gap-2">
                  <Button type="submit" size="sm">Save</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {pending > 0 && (
        <Card className="border-amber/30">
          <CardHeader>
            <CardTitle>Awaiting review</CardTitle>
            <Badge className="border-amber/40 bg-amber/10 text-amber">{pending} pending</Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ads
                .filter((a) => a.status === 'pending')
                .map((ad) => (
                  <div key={ad.id} className="rounded-lg border border-border bg-secondary/40 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{ad.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {emailOf(ad.user_id) ?? 'Unknown user'} · submitted {formatDateTime(ad.created_at)}
                          {ad.target_url ? ` · ${ad.target_url}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => void review(ad, 'approved')}>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void review(ad, 'rejected')}>
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          Reject
                        </Button>
                      </div>
                    </div>
                    <Input
                      placeholder="Optional note (shown to the user)"
                      value={noteById[ad.id] ?? ''}
                      onChange={(e) => setNoteById((m) => ({ ...m, [ad.id]: e.target.value }))}
                      className="mt-2"
                    />
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All ads</CardTitle>
          <Badge className="border-border bg-muted text-muted-foreground">{ads.length} total</Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {ads.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No ads yet — add one to show a global banner.</p>
            ) : (
              ads.map((ad) => (
                <div key={ad.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {ad.title}
                      {ad.price != null && (
                        <span className="ml-2 font-semibold text-accent">
                          {ad.price} {ad.price_currency ?? 'USD'}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ad.user_id ? `${emailOf(ad.user_id) ?? 'user ad'} · ` : 'platform · '}
                      {ad.placement} · {ad.clicks} clicks
                    </p>
                    {ad.status === 'rejected' && ad.reason && <p className="mt-1 text-xs text-destructive">Rejected: {ad.reason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={cn(AD_STATUS[ad.status], ad.status === 'approved' && !ad.active && 'opacity-70')}>
                      {ad.status}
                    </Badge>
                    {!ad.user_id && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => void toggle(ad)}>
                          {ad.active ? 'Hide' : 'Show'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(ad)}>Edit</Button>
                      </>
                    )}
                    <Button size="sm" variant="danger" onClick={() => void remove(ad.id)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------------------------------- Brokers --------------------------------- */

function BrokersTab() {
  const { brokers, refresh } = useBrokers(undefined)
  const [editing, setEditing] = useState<Partial<BrokerRow> | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing?.name || !editing.slug) return
    setMsg(null)
    const err = await saveBroker({
      id: editing.id,
      name: editing.name,
      slug: editing.slug,
      description: editing.description ?? '',
      admin_referral_code: editing.admin_referral_code ?? null,
      requires_api_key: editing.requires_api_key ?? true,
      platform: editing.platform ?? null,
      live_url: editing.live_url ?? null,
      practice_url: editing.practice_url ?? null,
      status: editing.status ?? 'coming_soon',
      sort: editing.sort ?? 99,
    })
    if (err) setMsg(err)
    else {
      setEditing(null)
      await refresh()
    }
  }

  const remove = async (id: string) => {
    await deleteBroker(id)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing({ name: '', slug: '', status: 'coming_soon' })}>+ New broker</Button>
      </div>
      {msg && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? 'Edit broker' : 'New broker'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              <Input label="Slug" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })} required />
              <Input label="Admin referral code" value={editing.admin_referral_code ?? ''} onChange={(e) => setEditing({ ...editing, admin_referral_code: e.target.value })} />
              <Select label="Status" value={editing.status ?? 'coming_soon'} onChange={(e) => setEditing({ ...editing, status: e.target.value as BrokerRow['status'] })}>
                <option value="available">Available</option>
                <option value="maintenance">Maintenance</option>
                <option value="coming_soon">Coming soon</option>
              </Select>
              <Select
                label="Execution platform"
                value={editing.platform ?? 'auto'}
                onChange={(e) => setEditing({ ...editing, platform: e.target.value === 'auto' ? null : (e.target.value as BrokerPlatform) })}
              >
                <option value="auto">Auto (from slug)</option>
                <option value="oanda">OANDA (REST API)</option>
                <option value="mt4">MetaTrader 4</option>
                <option value="mt5">MetaTrader 5</option>
              </Select>
              <Input label="Description" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              <Input label="Live API URL" value={editing.live_url ?? ''} onChange={(e) => setEditing({ ...editing, live_url: e.target.value })} />
              <Input label="Practice / demo API URL" value={editing.practice_url ?? ''} onChange={(e) => setEditing({ ...editing, practice_url: e.target.value })} />
              <div className="flex items-end justify-between gap-3 pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={editing.requires_api_key ?? true}
                    onChange={(e) => setEditing({ ...editing, requires_api_key: e.target.checked })}
                    className="h-4 w-4 cursor-pointer accent-emerald-500"
                  />
                  Connects with an API key
                </label>
                <div className="flex gap-2">
                  <Button type="submit" size="sm">Save</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave &quot;API key&quot; unchecked for MetaTrader 4/5 brokers that connect with account login, password and
                server instead of a REST token.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <div className="space-y-2">
            {brokers.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{b.name} <span className="text-xs text-muted-foreground">({b.slug})</span></p>
                  <p className="text-xs text-muted-foreground">
                    {b.status} · {b.requires_api_key ? 'API key' : 'MT account'} · platform: {b.platform ?? 'auto'} · referral:{' '}
                    {b.admin_referral_code ?? '—'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(b)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => void remove(b.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* -------------------------------- Commissions ------------------------------- */

function CommissionsTab() {
  const { referrals, refresh } = useAllReferrals()
  const { users } = useAdminUsers()
  const [msg, setMsg] = useState<string | null>(null)

  const emailOf = (id: string) => users.find((u) => u.id === id)?.email ?? '—'

  const setStatus = async (id: string, status: 'paid' | 'cancelled') => {
    setMsg(null)
    const err = await setReferralStatus(id, status)
    if (err) setMsg(err)
    else await refresh()
  }

  const pending = referrals.filter((r) => r.status === 'pending')
  const pendingTotal = pending.reduce((s, r) => s + r.commission_amount, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commission payouts</CardTitle>
        <Badge className="border-amber/40 bg-amber/10 text-amber">
          {pending.length} pending · {formatUsd(pendingTotal)}
        </Badge>
      </CardHeader>
      <CardContent>
        {msg && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Referrer</th>
                <th className="py-2 pr-4 font-medium">Referred</th>
                <th className="py-2 pr-4 font-medium">Pct</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-medium">{emailOf(r.referrer_id)}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{emailOf(r.referred_id)}</td>
                  <td className="py-2 pr-4 tnum">{r.commission_pct}%</td>
                  <td className="py-2 pr-4 tnum">{formatUsd(r.commission_amount)}</td>
                  <td className="py-2 pr-4">
                    <Badge
                      className={cn(
                        r.status === 'paid' && 'border-up/40 bg-up/10 text-up',
                        r.status === 'pending' && 'border-amber/40 bg-amber/10 text-amber',
                        r.status === 'cancelled' && 'border-border bg-muted text-muted-foreground',
                      )}
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(r.created_at)}</td>
                  <td className="py-2">
                    {r.status === 'pending' ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => void setStatus(r.id, 'paid')}>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Pay
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void setStatus(r.id, 'cancelled')}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------- Withdrawals ------------------------------- */

const WD_STATUS: Record<string, string> = {
  pending: 'border-amber/40 bg-amber/10 text-amber',
  approved: 'border-up/40 bg-up/10 text-up',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
}

function WithdrawalsTab() {
  const { withdrawals, refresh } = useAllWithdrawals()
  const { users } = useAdminUsers()
  const [msg, setMsg] = useState<string | null>(null)

  const emailOf = (id: string) => users.find((u) => u.id === id)?.email ?? '—'

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    setMsg(null)
    const w = withdrawals.find((x) => x.id === id)
    const err = await setWithdrawalStatus(id, status)
    if (err) setMsg(err)
    else {
      await refresh()
      if (w) {
        await notifyUser(
          w.user_id,
          status === 'approved' ? 'success' : 'error',
          status === 'approved' ? 'Withdrawal processed' : 'Withdrawal rejected',
          `${formatUsd(w.amount)} via ${w.method} — ${status === 'approved' ? 'your payout is on the way.' : 'the request was declined.'}`,
          '/account?tab=wallet',
        )
      }
    }
  }

  const pending = withdrawals.filter((w) => w.status === 'pending')
  const pendingTotal = pending.reduce((s, w) => s + w.amount, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdrawal requests</CardTitle>
        <Badge className="border-amber/40 bg-amber/10 text-amber">
          {pending.length} pending · {formatUsd(pendingTotal)}
        </Badge>
      </CardHeader>
      <CardContent>
        {msg && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}
        {withdrawals.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No withdrawal requests yet. Users request payouts from their Wallet page.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">User</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Method</th>
                  <th className="py-2 pr-4 font-medium">Address</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Requested</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[180px] truncate py-2 pr-4 font-medium">{emailOf(w.user_id)}</td>
                    <td className="py-2 pr-4 font-mono tnum font-medium">{formatUsd(w.amount)}</td>
                    <td className="py-2 pr-4 uppercase text-muted-foreground">
                      {w.method}
                      {w.method_detail ? <span className="block text-xs normal-case">{w.method_detail}</span> : null}
                    </td>
                    <td className="max-w-[200px] truncate py-2 pr-4 font-mono text-xs text-muted-foreground">
                      {w.account_holder ? <span className="font-sans font-medium">{w.account_holder} · </span> : null}
                      {w.wallet_address}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge className={WD_STATUS[w.status]}>{w.status}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(w.created_at)}</td>
                    <td className="py-2">
                      {w.status === 'pending' ? (
                        <div className="flex gap-1.5">
                          <Button size="sm" onClick={() => void setStatus(w.id, 'approved')}>
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            Approve
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void setStatus(w.id, 'rejected')}>
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{formatDateTime(w.processed_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------- Identity -------------------------------- */

const ID_STATUS: Record<string, string> = {
  unverified: 'border-border bg-muted text-muted-foreground',
  pending: 'border-amber/40 bg-amber/10 text-amber',
  verified: 'border-up/40 bg-up/10 text-up',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
}

function IdentityTab() {
  const { users, refresh } = useAdminUsers()
  const [msg, setMsg] = useState<string | null>(null)
  const [noteById, setNoteById] = useState<Record<string, string>>({})

  const review = async (id: string, status: 'verified' | 'rejected') => {
    setMsg(null)
    const person = users.find((u) => u.id === id)
    const err = await reviewIdentity(id, status, noteById[id])
    if (err) setMsg(err)
    else {
      await refresh()
      if (person) {
        await notifyUser(
          person.id,
          status === 'verified' ? 'success' : 'error',
          status === 'verified' ? 'Identity approved' : 'Identity check rejected',
          status === 'verified'
            ? 'Your identity has been verified — broker connections and payouts are unlocked.'
            : `Your identity check was rejected${noteById[id] ? `: ${noteById[id]}` : '.'}`,
          '/account?tab=profile',
        )
      }
    }
  }

  const checks = users.filter((u) => u.identity_status !== 'unverified')
  const pending = checks.filter((u) => u.identity_status === 'pending')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity checks</CardTitle>
        <Badge className="border-amber/40 bg-amber/10 text-amber">{pending.length} pending</Badge>
      </CardHeader>
      <CardContent>
        {msg && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}
        {checks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No identity checks yet. Users request verification from their Profile page.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">User</th>
                  <th className="py-2 pr-4 font-medium">Real name</th>
                  <th className="py-2 pr-4 font-medium">Document</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Submitted</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[180px] truncate py-2 pr-4 font-medium">{u.email ?? u.display_name ?? '—'}</td>
                    <td className="py-2 pr-4">{u.real_name ?? '—'}</td>
                    <td className="max-w-[160px] truncate py-2 pr-4 font-mono text-xs text-muted-foreground">
                      {u.identity_document ?? '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge className={ID_STATUS[u.identity_status]}>{u.identity_status}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(u.identity_submitted_at)}</td>
                    <td className="py-2">
                      {u.identity_status === 'pending' ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => void review(u.id, 'verified')}>
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              Approve
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => void review(u.id, 'rejected')}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                              Reject
                            </Button>
                          </div>
                          <Input
                            placeholder="Optional note (shown to user)"
                            value={noteById[u.id] ?? ''}
                            onChange={(e) => setNoteById((m) => ({ ...m, [u.id]: e.target.value }))}
                            className="max-w-[220px]"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{u.identity_reason ?? '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* --------------------------------- Payments -------------------------------- */

const PAYMENT_DETAIL_FIELDS: Record<PaymentMethod, { key: string; label: string }[]> = {
  qris: [
    { key: 'qr_ref', label: 'QRIS reference / image link' },
    { key: 'holder', label: 'Name' },
  ],
  bank: [
    { key: 'bank_name', label: 'Bank name (e.g. BCA)' },
    { key: 'account_holder', label: 'Account holder' },
    { key: 'account_number', label: 'Account number' },
  ],
  ewallet: [
    { key: 'provider', label: 'Provider (GoPay/OVO/DANA)' },
    { key: 'account_holder', label: 'Account holder' },
    { key: 'account_id', label: 'Account ID' },
  ],
  paypal: [{ key: 'email', label: 'PayPal email' }],
  usdt: [
    { key: 'network', label: 'Network (TRC-20/BEP-20/ERC-20)' },
    { key: 'wallet', label: 'Wallet address' },
  ],
}

function PaymentsTab() {
  const { accounts, refresh } = usePaymentAccounts()
  const [editing, setEditing] = useState<Partial<PaymentAccountRow> | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const startNew = () => setEditing({ method: 'bank', label: '', details: {}, enabled: true, sort: accounts.length })

  const setDetail = (key: string, value: string) =>
    setEditing((e) => (e ? { ...e, details: { ...(e.details ?? {}), [key]: value } } : e))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing?.label) return
    setMsg(null)
    const err = await savePaymentAccount({
      id: editing.id,
      method: editing.method ?? 'bank',
      label: editing.label,
      details: editing.details ?? {},
      enabled: editing.enabled ?? true,
      sort: Number(editing.sort) || 0,
    })
    if (err) setMsg(err)
    else {
      setEditing(null)
      await refresh()
    }
  }

  const remove = async (id: string) => {
    await deletePaymentAccount(id)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={startNew}>
          + New payment account
        </Button>
      </div>
      {msg && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">{msg}</p>}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? 'Edit payment account' : 'New payment account'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Method"
                value={editing.method ?? 'bank'}
                onChange={(e) => setEditing({ ...editing, method: e.target.value as PaymentMethod })}
              >
                {Object.entries(PAYMENT_METHOD_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input
                label="Label (shown to buyers)"
                value={editing.label ?? ''}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="e.g. Bank BCA — primary"
                required
              />
              {(PAYMENT_DETAIL_FIELDS[editing.method ?? 'bank'] ?? []).map((f) => (
                <Input
                  key={f.key}
                  label={f.label}
                  value={editing.details?.[f.key] ?? ''}
                  onChange={(e) => setDetail(f.key, e.target.value)}
                />
              ))}
              <div className="flex items-end gap-3 pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={editing.enabled ?? true}
                    onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                    className="h-4 w-4 cursor-pointer accent-emerald-500"
                  />
                  Enabled (shown on Packages)
                </label>
                <div className="ml-auto flex gap-2">
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <div className="space-y-2">
            {accounts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No receiving accounts yet — add a QRIS, bank, e-wallet, PayPal or USDT account so buyers see where to pay.
              </p>
            ) : (
              accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {a.label} <span className="text-xs text-muted-foreground">({PAYMENT_METHOD_LABEL[a.method]})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Object.entries(a.details ?? {})
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge className={a.enabled ? 'border-up/40 bg-up/10 text-up' : 'border-border bg-muted text-muted-foreground'}>
                      {a.enabled ? 'Enabled' : 'Hidden'}
                    </Badge>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------------------------------- Settings -------------------------------- */

function SettingsTab() {
  const { settings, refresh } = useSettings()
  const trial = settingValue(settings, 'trial', { trial_minutes: 30 })
  const robot = settingValue(settings, 'robot', { default_duration_minutes: 60, auto_tune_samples: 300 })
  const [trialMin, setTrialMin] = useState(Number(trial.trial_minutes) || 30)
  const [durationMin, setDurationMin] = useState(Number(robot.default_duration_minutes) || 60)
  const [samples, setSamples] = useState(Number(robot.auto_tune_samples) || 300)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async () => {
    setMsg(null)
    const e1 = await saveSetting('trial', { trial_minutes: trialMin })
    const e2 = await saveSetting('robot', { default_duration_minutes: durationMin, auto_tune_samples: samples })
    if (e1 || e2) setMsg(e1 ?? e2)
    else {
      await refresh()
      setMsg('Saved ✓')
      setTimeout(() => setMsg(null), 2000)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Platform settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-lg gap-4">
            <Input
              label="Free trial length (minutes)"
              type="number"
              min={1}
              value={trialMin}
              onChange={(e) => setTrialMin(Number(e.target.value))}
            />
            <Input
              label="Default robot auto-run duration (minutes)"
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
            <Input
              label="Auto-tune sample bars"
              type="number"
              min={30}
              value={samples}
              onChange={(e) => setSamples(Number(e.target.value))}
            />
            {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
            <div>
              <Button onClick={() => void save()}>Save settings</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <MarketDataEditor />

      <ContactEditor />
    </div>
  )
}

/** Admin configures which market-data provider feeds the platform and its API key. */
function MarketDataEditor() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [providers, setProviders] = useState<{
    id: string
    label: string
    configured: boolean
    keyless?: boolean
    source?: 'keyed' | 'keyless' | 'broker'
  }[]>([])
  const [provider, setProvider] = useState('twelvedata')
  const [providerLabel, setProviderLabel] = useState('Twelve Data')
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  const [activeProviderLabel, setActiveProviderLabel] = useState<string | null>(null)
  const [fallbackAvailable, setFallbackAvailable] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [activatingFree, setActivatingFree] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  type ProviderOption = { id: string; label: string; configured: boolean; keyless?: boolean; source?: 'keyed' | 'keyless' | 'broker' }

  const applyConfig = (cfg: {
    provider: string
    provider_label: string
    configured: boolean
    providers: ProviderOption[]
    active_provider?: string | null
    active_provider_label?: string | null
    fallback_available?: boolean
  }) => {
    setConfigured(cfg.configured)
    setProvider(cfg.provider)
    setProviderLabel(cfg.provider_label)
    setActiveProvider(cfg.active_provider ?? null)
    setActiveProviderLabel(cfg.active_provider_label ?? null)
    setFallbackAvailable(Boolean(cfg.fallback_available))
    if (Array.isArray(cfg.providers) && cfg.providers.length > 0) {
      setProviders(cfg.providers)
    }
  }

  useEffect(() => {
    let alive = true
    void fetchMarketDataConfig().then((cfg) => {
      if (!alive || !cfg) return
      applyConfig(cfg)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Providers the backend reports; fall back to the known catalog if it says nothing yet.
  const providerOptions: ProviderOption[] = providers.length > 0
    ? providers
    : [
        { id: 'twelvedata', label: 'Twelve Data', configured: provider === 'twelvedata' && !!configured },
        { id: 'finnhub', label: 'Finnhub', configured: provider === 'finnhub' && !!configured },
        { id: 'oanda', label: 'OANDA', configured: provider === 'oanda' && !!configured, keyless: true, source: 'broker' },
        { id: 'yahoo', label: 'Free market data', configured: true, keyless: true, source: 'keyless' },
      ]

  const selectedOption = providerOptions.find((p) => p.id === provider)
  const isBrokerSource = selectedOption?.source === 'broker'
  const isFreeSource = selectedOption?.source === 'keyless'
  const isServingViaFallback = !!activeProvider && !!provider && activeProvider !== provider

  const selectProvider = (id: string) => {
    const def = providerOptions.find((p) => p.id === id)
    setProvider(id)
    setProviderLabel(def?.label ?? id)
    setConfigured(def?.configured ?? false)
    setApiKey('')
    setConfirmDisconnect(false)
    setMsg(null)
    setErr(null)
  }

  const save = async () => {
    if (isBrokerSource) {
      setMsg(null)
      setErr(`${providerLabel} needs no API key — use the broker account button below to switch the platform to it.`)
      return
    }
    if (isFreeSource) {
      setMsg(null)
      setErr(`${providerLabel} is the free, keyless source — kick it in with the button below, no key to paste.`)
      return
    }
    const key = apiKey.trim()
    if (!key) {
      setErr('Paste the API key first.')
      setMsg(null)
      return
    }
    setErr(null)
    setMsg(null)
    setSaving(true)
    const e = await updateMarketDataApiKey(key, provider)
    setSaving(false)
    if (e) {
      setErr(e)
    } else {
      setApiKey('')
      setConfigured(true)
      setProviders((ps) => ps.map((p) => (p.id === provider ? { ...p, configured: true } : p)))
      setMsg(`API key saved — ${providerLabel} is now the active market data provider.`)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  const disconnect = async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true)
      setTimeout(() => setConfirmDisconnect(false), 4000)
      return
    }
    setConfirmDisconnect(false)
    setErr(null)
    setMsg(null)
    setDisconnecting(true)
    const e = await disconnectMarketData(provider)
    setDisconnecting(false)
    if (e) {
      setErr(e)
    } else {
      setConfigured(false)
      setApiKey('')
      setProviders((ps) => ps.map((p) => (p.id === provider ? { ...p, configured: false } : p)))
      setMsg(`${providerLabel} disconnected — market data is paused until you connect again.`)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  const provisionFromBroker = async () => {
    setErr(null)
    setMsg(null)
    setProvisioning(true)
    const e = await provisionMarketDataFromBroker('oanda')
    setProvisioning(false)
    if (e) {
      setErr(e)
      return
    }
    const cfg = await fetchMarketDataConfig()
    if (cfg) applyConfig(cfg)
    setMsg('OANDA is now the platform market data source — quotes and charts flow through your broker account, no API key needed.')
    setTimeout(() => setMsg(null), 6000)
  }

  const activateFree = async () => {
    setErr(null)
    setMsg(null)
    setActivatingFree(true)
    const res = await activateFreeMarketData()
    setActivatingFree(false)
    if (res.error) {
      setErr(res.error)
      return
    }
    const cfg = res.config ?? (await fetchMarketDataConfig())
    if (cfg) applyConfig(cfg)
    setMsg(res.message ?? 'Free market data is now the main source — no API key needed.')
    setTimeout(() => setMsg(null), 6000)
  }

  const refresh = async () => {
    const cfg = await fetchMarketDataConfig()
    if (cfg) applyConfig(cfg)
  }

  const statusText =
    isServingViaFallback && activeProviderLabel
      ? `Serving quotes via ${activeProviderLabel} — your ${providerLabel} feed is down (key, quota or network).`
      : configured
        ? `Serving quotes via ${providerLabel}${isBrokerSource ? ' — broker account, no API key' : isFreeSource ? ' — free source, no API key' : ' — API key'}${fallbackAvailable ? ' — keyless fallback ready' : ''}`
        : activeProviderLabel
          ? `Serving quotes via ${activeProviderLabel}`
          : 'No market data source — quotes and charts are paused'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market data provider</CardTitle>
        <Badge className="border-border bg-muted text-muted-foreground">Forex &amp; crypto quotes for the whole platform</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid max-w-lg gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <KeyRound className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">{activeProviderLabel ?? providerLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {configured === null && activeProviderLabel === null ? 'checking…' : statusText}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void refresh()}
                className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                aria-label="Refresh market data status"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
              {isServingViaFallback ? (
                <Badge className="border-amber/40 bg-amber/10 text-amber">Fallback live</Badge>
              ) : configured || activeProviderLabel ? (
                <Badge className="border-up/40 bg-up/10 text-up">Live</Badge>
              ) : (
                <Badge className="border-amber/40 bg-amber/10 text-amber">Disconnected</Badge>
              )}
            </div>
          </div>

          <Select label="Provider" value={provider} onChange={(e) => selectProvider(e.target.value)}>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>

          {isBrokerSource ? (
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4 text-accent" aria-hidden="true" />
                No API key needed
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Quotes are fetched through your {providerLabel} trading account, so there's nothing to paste. If the
                account isn't connected yet, add it on the{' '}
                <Link to="/brokers" className="text-accent hover:underline">Brokers</Link> page first, then come back here
                and switch the platform to it.
              </p>
              <Button className="mt-3" onClick={() => void provisionFromBroker()} loading={provisioning}>
                <Zap className="h-4 w-4" aria-hidden="true" />
                Use my {providerLabel} account
              </Button>
            </div>
          ) : isFreeSource ? (
            <div className="rounded-lg border border-up/30 bg-up/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4 text-accent" aria-hidden="true" />
                Free market data — no API key
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The built-in free source needs no signup and no key: crypto pairs come from Binance&apos;s public feed,
                forex from Yahoo Finance — all proxied and cached server-side. One click makes it the app&apos;s main
                market data API.
              </p>
              <Button
                className="mt-3"
                onClick={() => void activateFree()}
                loading={activatingFree}
                disabled={provider === 'yahoo' && activeProvider === 'yahoo'}
              >
                <Zap className="h-4 w-4" aria-hidden="true" />
                {provider === 'yahoo' && activeProvider === 'yahoo' ? 'Free market data is active' : 'Activate free market data'}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  label={`${providerLabel} API key`}
                  type={show ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder={configured ? 'Paste a new key to replace the current one' : 'Paste your API key to go live'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="flex-1"
                />
                <label className="flex cursor-pointer items-end gap-1.5 pb-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(e) => setShow(e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-emerald-500"
                  />
                  Show
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void save()} loading={saving} disabled={!apiKey.trim()}>
                  {configured ? 'Replace API key' : 'Connect provider'}
                </Button>
                {configured && !isBrokerSource && !isFreeSource && (
                  <Button
                    variant={confirmDisconnect ? 'danger' : 'secondary'}
                    onClick={() => void disconnect()}
                    loading={disconnecting}
                  >
                    <Unplug className="h-4 w-4" aria-hidden="true" />
                    {confirmDisconnect ? 'Click again to disconnect' : 'Disconnect'}
                  </Button>
                )}
              </div>
            </>
          )}

          {err && <p className="text-sm text-red-200">{err}</p>}
          {msg && <p className="text-sm text-up">{msg}</p>}

          {isServingViaFallback && activeProviderLabel && (
            <p className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber-200/90">
              The platform is currently serving quotes from {activeProviderLabel} because the {providerLabel} feed isn't
              returning data (expired key, exceeded quota, or network issues). Fix or replace the key above to restore
              the primary feed.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {isFreeSource ? (
              <>
                Free market data needs no key — crypto quotes come from Binance&apos;s public API and forex from Yahoo
                Finance, all proxied and cached server-side. It is also the automatic fallback whenever a keyed provider
                fails, so quotes never stop.
              </>
            ) : isBrokerSource ? (
              <>
                {providerLabel} needs no key — quotes come from your connected trading account via the market data
                service.
              </>
            ) : (
              <>
                The key is stored server-side and only used inside the market data service — it is never exposed to
                visitors or sent to the browser. Connecting also makes {providerLabel} the active provider for quotes
                and charts. Get a key at {provider === 'finnhub' ? 'finnhub.io' : 'twelvedata.com'}. Disconnecting
                pauses market data until you connect again. Changes take effect immediately.
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}


/** Admin edits the email / WhatsApp / phone shown on the public Contact page. */
function ContactEditor() {
  const { contact, loading, refresh } = useContactSettings()
  const [email, setEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [phone, setPhone] = useState('')
  const [synced, setSynced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && contact && !synced) {
      setEmail(contact.email ?? '')
      setWhatsapp(contact.whatsapp ?? '')
      setPhone(contact.phone ?? '')
      setSynced(true)
    }
  }, [loading, contact, synced])

  const save = async () => {
    setMsg(null)
    setSaving(true)
    const err = await saveContactSettings({ email: email.trim(), whatsapp: whatsapp.trim(), phone: phone.trim() })
    setSaving(false)
    if (err) {
      setMsg(err)
    } else {
      await refresh()
      setMsg('Saved ✓')
      setTimeout(() => setMsg(null), 2000)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact details</CardTitle>
        <Badge className="border-border bg-muted text-muted-foreground">Shown on the public Contact page</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid max-w-lg gap-4">
          <Input
            label="Contact email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="support@yourdomain.com"
          />
          <Input
            label="WhatsApp number"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="e.g. +1 234 567 890"
          />
          <Input
            label="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. +1 234 567 890"
          />
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
          <div>
            <Button onClick={() => void save()} loading={saving}>
              Save contact details
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            These appear on /contact. The email is also used by the footer link and the direct-mail form. Leave WhatsApp
            or phone empty to hide that channel.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}