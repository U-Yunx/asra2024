/**
 * TradeForm — manual order entry. Picks a pair + side, computes a risk-based
 * position size (or lets the user override units), and shows the implied stop
 * and target levels before submitting through the active broker.
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { AccountState, OpenPositionRequest, RatesMap, Side } from '../../lib/trading/types'
import { equity } from '../../lib/trading/engine'
import { pipValueUsd, stopTakePrices, suggestPositionUnits } from '../../lib/trading/risk'
import { WATCHLIST } from '../../lib/watchlist'
import { formatPrice, formatUsd } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '../ui'

export function TradeForm({
  account,
  rates,
  onOpen,
}: {
  account: AccountState
  rates: RatesMap
  onOpen: (req: OpenPositionRequest, rates: RatesMap) => Promise<{ error: string | null }>
}) {
  const [symbol, setSymbol] = useState('EUR/USD')
  const [side, setSide] = useState<Side>('long')
  const [stopPips, setStopPips] = useState(20)
  const [takePips, setTakePips] = useState(40)
  const [units, setUnits] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const price = rates[symbol]
  const pipValue = pipValueUsd(symbol, rates)
  const suggested = useMemo(() => {
    if (pipValue == null || pipValue <= 0) return 0
    return suggestPositionUnits({
      equity: equity(account, rates),
      riskPct: account.risk.riskPerTradePct,
      stopPips,
      pipValue,
    })
  }, [account, rates, pipValue, stopPips])

  const effectiveUnits = units ?? suggested
  const levels = useMemo(
    () => (price != null ? stopTakePrices(symbol, side, price, stopPips, takePips) : null),
    [symbol, side, price, stopPips, takePips],
  )

  const submit = async () => {
    if (price == null) {
      setError('No live price for this pair yet — pick a pair that is quoting.')
      return
    }
    if (effectiveUnits <= 0) {
      setError('Position size is zero — lower the stop or raise the risk per trade.')
      return
    }
    setBusy(true)
    setError(null)
    setOk(false)
    const res = await onOpen(
      {
        symbol,
        side,
        entryPrice: price,
        stopPips,
        takeProfitPips: takePips,
        units: effectiveUnits,
        strategy: 'manual',
      },
      rates,
    )
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setOk(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual trade</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Pair" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {WATCHLIST.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.symbol} — {p.name}
              </option>
            ))}
          </Select>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Side</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSide('long')}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold',
                  side === 'long'
                    ? 'border-up/60 bg-up/15 text-up'
                    : 'border-border bg-background/60 text-muted-foreground hover:text-foreground',
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> Buy
              </button>
              <button
                type="button"
                onClick={() => setSide('short')}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold',
                  side === 'short'
                    ? 'border-down/60 bg-down/15 text-down'
                    : 'border-border bg-background/60 text-muted-foreground hover:text-foreground',
                )}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> Sell
              </button>
            </div>
          </div>
          <Input
            label="Stop loss"
            type="number"
            min={1}
            step={1}
            value={stopPips}
            onChange={(e) => setStopPips(Number(e.target.value))}
          />
          <Input
            label="Take profit"
            type="number"
            min={1}
            step={1}
            value={takePips}
            onChange={(e) => setTakePips(Number(e.target.value))}
          />
          <Input
            label={`Units (suggested ${suggested})`}
            type="number"
            min={1}
            step={1}
            value={effectiveUnits}
            onChange={(e) => setUnits(e.target.value === '' ? null : Number(e.target.value))}
          />
          <div className="flex items-end rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              <p className="text-[11px] uppercase tracking-wide">Market</p>
              <p className="tnum font-mono text-sm text-foreground">{formatPrice(price)}</p>
              {levels && (
                <p className="mt-0.5 tnum font-mono text-[11px]">
                  Stop {formatPrice(levels.stopPrice)} · Target {formatPrice(levels.takeProfitPrice)}
                </p>
              )}
            </div>
          </div>
        </div>

        {pipValue != null && (
          <p className="mt-3 text-xs text-muted-foreground">
            Pip value ≈ <span className="tnum font-mono">{formatUsd(pipValue)}</span>/unit · risk at stop ≈{' '}
            <span className="tnum font-mono">{formatUsd(pipValue * stopPips * effectiveUnits)}</span>
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {ok && (
          <p role="status" className="mt-3 rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
            Order placed. It will be marked to market as prices update.
          </p>
        )}

        <Button className="mt-4 w-full" loading={busy} onClick={() => void submit()} disabled={price == null}>
          {side === 'long' ? 'Buy' : 'Sell'} {symbol}
        </Button>
      </CardContent>
    </Card>
  )
}