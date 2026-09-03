/**
 * Gateway — payout centre. Shows the manual payment gateway's supported
 * methods, your withdrawable balance, lets you request a withdrawal, and lists
 * prior requests with their status.
 */
import { useState } from 'react'
import { CreditCard, Landmark, Send } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useWithdrawals } from '../hooks/usePlatform'
import { gatewaySummary, validateOrderAmount } from '../lib/paymentGateway'
import { WITHDRAW_METHODS, getWithdrawCountry, DEFAULT_WITHDRAW_COUNTRY, INDONESIAN_BANKS, INDONESIAN_EWALLETS } from '../lib/paymentMethods'
import { requestWithdrawal, fetchWithdrawableBalance } from '../lib/platform'
import { formatDateTime, formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, PageHeader, Select } from '../components/ui'

const STATUS_TONE: Record<string, string> = {
  pending: 'border-amber/40 bg-amber/15 text-amber',
  approved: 'border-up/40 bg-up/15 text-up',
  rejected: 'border-destructive/40 bg-destructive/15 text-destructive',
}

export function Gateway() {
  const { user } = useAuth()
  const { withdrawals, loading, refresh } = useWithdrawals(user?.id)
  const summary = gatewaySummary()

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('bank')
  const [wallet, setWallet] = useState('')
  const [detail, setDetail] = useState('')
  const [holder, setHolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [withdrawable, setWithdrawable] = useState<number | null>(null)

  const country = getWithdrawCountry(DEFAULT_WITHDRAW_COUNTRY)

  const loadBalance = async () => {
    if (!user) return
    setWithdrawable(await fetchWithdrawableBalance(user.id))
  }
  void loadBalance()

  const submit = async () => {
    if (!user) return
    const amt = Number(amount)
    const amountError = validateOrderAmount(amt)
    if (amountError) {
      setError(amountError)
      return
    }
    if (!wallet.trim()) {
      setError('Enter the payout destination (bank account, e-wallet number or wallet address).')
      return
    }
    setBusy(true)
    setError(null)
    setOk(false)
    const res = await requestWithdrawal({
      userId: user.id,
      amount: amt,
      method,
      walletAddress: wallet,
      methodDetail: detail || undefined,
      accountHolder: holder || undefined,
    })
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setOk(true)
    setAmount('')
    setWallet('')
    setDetail('')
    setHolder('')
    void refresh()
    void loadBalance()
  }

  const methodDef = WITHDRAW_METHODS.find((m) => m.id === method)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gateway & payouts"
        description="Request payouts of your earned commissions through the platform's manual payment gateway."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Withdrawable balance" value={withdrawable != null ? formatUsd(withdrawable) : '—'} tone="up" />
        <Stat label="Supported methods" value={String(summary.methods.length)} />
        <Stat label="Order range" value={`$${summary.minOrderUsd}–$${summary.maxOrderUsd.toLocaleString()}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-accent" aria-hidden="true" />
              Request a withdrawal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input
                label="Amount (USD)"
                type="number"
                min={summary.minOrderUsd}
                max={summary.maxOrderUsd}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`$${summary.minOrderUsd} – $${summary.maxOrderUsd.toLocaleString()}`}
              />
              <Select label="Payout method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {WITHDRAW_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
              {method === 'bank' && (
                <Select label="Bank" value={detail} onChange={(e) => setDetail(e.target.value)}>
                  <option value="">Select a bank…</option>
                  {INDONESIAN_BANKS.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
              {method === 'ewallet' && (
                <Select label="E-wallet" value={detail} onChange={(e) => setDetail(e.target.value)}>
                  <option value="">Select an e-wallet…</option>
                  {INDONESIAN_EWALLETS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                label={method === 'usdt' ? 'Wallet address' : method === 'bank' ? 'Account number' : 'E-wallet / account number'}
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder={method === 'usdt' ? 'TRC-20 / BEP-20 / ERC-20 address' : 'Destination number'}
              />
              <Input label="Account holder name" value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Name on the account" />
            </div>

            {methodDef && <p className="mt-3 text-xs text-muted-foreground">{methodDef.hint}</p>}

            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {ok && (
              <p role="status" className="mt-3 rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
                Withdrawal requested — an admin will review and process it.
              </p>
            )}

            <Button className="mt-4 w-full" loading={busy} onClick={() => void submit()}>
              Request withdrawal
            </Button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Payouts are processed manually. Typical turnaround is 1–3 business days.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-accent" aria-hidden="true" />
              Supported payout methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2">
              {summary.methods.map((m) => (
                <div key={m.method} className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    {m.method === 'bank' ? (
                      <Landmark className="h-4 w-4 text-accent" aria-hidden="true" />
                    ) : (
                      <CreditCard className="h-4 w-4 text-accent" aria-hidden="true" />
                    )}
                    {m.label}
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.method}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Region defaults: {country.name}. Local banks and e-wallets are listed when you pick a
              payout method.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Withdrawal history</CardTitle>
          {withdrawals.length > 0 && <span className="text-xs text-muted-foreground">{withdrawals.length} requests</span>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading withdrawals…</p>
          ) : withdrawals.length === 0 ? (
            <EmptyState
              title="No withdrawals yet"
              message="Once you've earned commission from referrals, request your first payout above."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 text-right font-medium">Amount</th>
                    <th className="pb-2 pr-4 font-medium">Method</th>
                    <th className="pb-2 pr-4 font-medium">Destination</th>
                    <th className="pb-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr key={w.id} className="border-b border-border/50 last:border-b-0">
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground">{formatDateTime(w.created_at)}</td>
                      <td className="tnum py-2.5 pr-4 text-right font-mono">{formatUsd(w.amount)}</td>
                      <td className="py-2.5 pr-4 capitalize">{w.method_detail || w.method}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{w.wallet_address}</td>
                      <td className="py-2.5 text-right">
                        <Badge className={cn(STATUS_TONE[w.status] ?? STATUS_TONE.pending)}>{w.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 tnum font-mono text-xl font-bold', tone === 'up' ? 'text-up' : 'text-foreground')}>
        {value}
      </p>
    </div>
  )
}