/**
 * Packages — public pricing page. Lists every active package with its price,
 * robot / MT4/5 account slots, plus the admin-managed receiving accounts
 * (QRIS, bank, e-wallet, PayPal, USDT). A buyer picks a package + billing
 * duration, notes their payment reference and submits; an admin activates the
 * subscription manually from the Admin console.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { Check, CreditCard, ShoppingCart } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  useAddonPurchases,
  useAddons,
  usePackages,
  usePaymentAccounts,
  useProfile,
  useSubscriptions,
} from '../hooks/usePlatform'
import { createAddonPurchase, createSubscription, notifyAdmin } from '../lib/platform'
import { PAYMENT_METHOD_LABEL } from '../lib/paymentMethods'
import { formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, PageHeader, Select } from '../components/ui'
import { AddOnsSection } from '../components/AddOnsSection'
import type { AddonRow, PackageRow } from '../lib/types'

const DURATIONS = [1, 7, 30, 90, 180, 365]

export function Packages() {
  const { user } = useAuth()
  const { packages } = usePackages()
  const { accounts } = usePaymentAccounts()
  const { profile } = useProfile()
  const { subscriptions } = useSubscriptions(user?.id)
  const { addons } = useAddons()
  const { purchases, refresh: refreshPurchases } = useAddonPurchases(user?.id)

  const [selected, setSelected] = useState<PackageRow | null>(null)
  const [durationDays, setDurationDays] = useState(30)
  const [method, setMethod] = useState('qris')
  const [txRef, setTxRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const enabledAccounts = useMemo(() => accounts.filter((a) => a.enabled), [accounts])
  const activeCount = subscriptions.filter((s) => s.status === 'active').length

  async function handleBuy(e: FormEvent) {
    e.preventDefault()
    if (!user) {
      setError('Sign in before buying a package.')
      return
    }
    if (!selected) {
      setError('Pick a package first.')
      return
    }
    if (!txRef.trim()) {
      setError('Add the payment reference so the admin can verify your transfer.')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    const amount = Number(selected.price)
    const res = await createSubscription({
      user_id: user.id,
      package_id: selected.id,
      amount,
      tx_ref: txRef.trim(),
      robots: selected.robots,
      mt_accounts: selected.mt_accounts,
      duration_days: durationDays,
      payment_method: method,
    })
    if (res.error) {
      setError(res.error)
    } else {
      setSuccess(`Order for ${selected.name} submitted — an admin will verify your transfer shortly.`)
      await notifyAdmin(
        'info',
        'New package order',
        `${profile?.email ?? user.email} ordered ${selected.name} (${formatUsd(amount)}) via ${PAYMENT_METHOD_LABEL[method as keyof typeof PAYMENT_METHOD_LABEL] ?? method}.`,
        '/admin',
      )
      setTxRef('')
      setSelected(null)
    }
    setBusy(false)
  }

  async function handleBuyAddon(addon: AddonRow) {
    if (!user) {
      setError('Sign in before buying an add-on.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await createAddonPurchase({
      user_id: user.id,
      addon_id: addon.id,
      amount: Number(addon.price),
      currency: addon.currency,
      tx_ref: 'manual',
      duration_days: 30,
      payment_method: 'crypto',
    })
    if (res.error) {
      setError(res.error)
    } else {
      setSuccess(`Add-on "${addon.name}" ordered — an admin will activate it shortly.`)
      await notifyAdmin('info', 'New add-on order', `${profile?.email ?? user.email} ordered ${addon.name}.`, '/admin')
      await refreshPurchases()
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Packages"
        description={
          <>
            Pick a plan to unlock robots and MT4/5 accounts. Transfers are verified manually — share your payment
            reference after paying.
            {activeCount > 0 && (
              <span className="mt-1 block text-xs text-muted-foreground">
                You have {activeCount} active plan{activeCount === 1 ? '' : 's'}.
              </span>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-lg border border-up/40 bg-up/10 px-4 py-3 text-sm text-up">{success}</div>
      )}

      {packages.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-8 w-8" aria-hidden="true" />}
          title="No packages yet"
          message="The admin hasn't published any plans. Check back soon."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages
            .filter((p) => p.active)
            .map((pkg) => (
              <Card
                key={pkg.id}
                className={cn(
                  'flex flex-col transition-colors',
                  selected?.id === pkg.id && 'border-accent ring-1 ring-accent/40',
                )}
              >
                <CardHeader>
                  <CardTitle>{pkg.name}</CardTitle>
                  <div className="text-2xl font-bold text-foreground">
                    {formatUsd(Number(pkg.price))}
                    <span className="text-xs font-normal text-muted-foreground"> / {pkg.duration_days}d</span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  {pkg.description && <p className="text-sm text-muted-foreground">{pkg.description}</p>}
                  <ul className="mt-3 space-y-2 text-sm text-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-up" aria-hidden="true" /> {pkg.robots} robot slot{pkg.robots === 1 ? '' : 's'}
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-up" aria-hidden="true" /> {pkg.mt_accounts} MT4/5 account
                      {pkg.mt_accounts === 1 ? '' : 's'}
                    </li>
                    {typeof pkg.commission_pct === 'number' && pkg.commission_pct > 0 && (
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-up" aria-hidden="true" /> {pkg.commission_pct}% referral commission
                      </li>
                    )}
                  </ul>
                </CardContent>
                <Button
                  variant={selected?.id === pkg.id ? 'primary' : 'secondary'}
                  className="mt-4 w-full"
                  onClick={() => setSelected(pkg)}
                >
                  {selected?.id === pkg.id ? 'Selected' : 'Select'}
                </Button>
              </Card>
            ))}
        </div>
      )}

      {selected && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Complete your order — {selected.name}</CardTitle>
            <Badge>{formatUsd(Number(selected.price))}</Badge>
          </CardHeader>
          <form onSubmit={handleBuy} className="grid gap-4 sm:grid-cols-2">
            <Select label="Billing duration" value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} day{d === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
            <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {enabledAccounts.map((a) => (
                <option key={a.id} value={a.method}>
                  {PAYMENT_METHOD_LABEL[a.method] ?? a.label}
                </option>
              ))}
            </Select>
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs text-muted-foreground">Transfer to:</p>
              {enabledAccounts
                .filter((a) => a.method === method)
                .map((a) => (
                  <div key={a.id} className="rounded-lg border border-border bg-background/40 px-3 py-2 font-mono text-sm text-foreground">
                    {a.label}: {Object.entries(a.details ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}
                  </div>
                ))}
            </div>
            <Input
              label="Payment reference (tx id)"
              placeholder="e.g. 8f3a… (or your name if bank transfer)"
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
              required
            />
            <div className="flex items-end">
              <Button type="submit" loading={busy} className="w-full">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Submit order
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="mt-10">
        <AddOnsSection addons={addons.filter((a) => a.active)} purchases={purchases} onPurchase={handleBuyAddon} />
      </div>
    </div>
  )
}
