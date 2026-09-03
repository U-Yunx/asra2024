/**
 * RiskPanel — the risk-management editor the robot enforces. Every knob maps
 * 1:1 onto the engine's RiskConfig; changing a field pushes a partial patch
 * through the parent (which may gate auto-trading on the risk disclaimer).
 */
import { RotateCcw, ShieldAlert } from 'lucide-react'
import type { RiskConfig } from '../../lib/trading/types'
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '../ui'

interface Props {
  risk: RiskConfig
  onChange: (patch: Partial<RiskConfig>) => void
  onReset: () => void
  isLive: boolean
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max?: number
  step: number
  suffix?: string
}) {
  return (
    <Input
      label={`${label}${suffix ? ` (${suffix})` : ''}`}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

export function RiskPanel({ risk, onChange, onReset, isLive }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber" aria-hidden="true" />
          Risk management
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset
        </Button>
      </CardHeader>
      <CardContent>
        {isLive && (
          <p className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
            Live mode — these limits are enforced on your real account.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Risk per trade"
            value={risk.riskPerTradePct}
            onChange={(v) => onChange({ riskPerTradePct: v })}
            min={0}
            step={0.1}
            suffix="%"
          />
          <Field
            label="Max open positions"
            value={risk.maxOpenPositions}
            onChange={(v) => onChange({ maxOpenPositions: v })}
            min={1}
            max={50}
            step={1}
          />
          <Field
            label="Default stop"
            value={risk.defaultStopPips}
            onChange={(v) => onChange({ defaultStopPips: v })}
            min={1}
            step={1}
            suffix="pips"
          />
          <Field
            label="Risk:reward"
            value={risk.takeProfitRatio}
            onChange={(v) => onChange({ takeProfitRatio: v })}
            min={0.5}
            step={0.1}
            suffix="×"
          />
          <Field
            label="Daily loss limit"
            value={risk.maxDailyLossPct}
            onChange={(v) => onChange({ maxDailyLossPct: v })}
            min={0}
            step={0.5}
            suffix="%"
          />
          <Field
            label="Trailing stop"
            value={risk.trailPips}
            onChange={(v) => onChange({ trailPips: v })}
            min={0}
            step={1}
            suffix="pips"
          />
          <Field
            label="Break-even at"
            value={risk.breakEvenPips}
            onChange={(v) => onChange({ breakEvenPips: v })}
            min={0}
            step={1}
            suffix="pips"
          />
          <Field
            label="Trail activation"
            value={risk.trailActivationPips}
            onChange={(v) => onChange({ trailActivationPips: v })}
            min={0}
            step={1}
            suffix="pips"
          />
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={risk.trailingStop}
            onChange={(e) => onChange({ trailingStop: e.target.checked })}
            className="h-4 w-4 cursor-pointer rounded border-border bg-background accent-[var(--color-accent)]"
          />
          Trailing stop
        </label>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={risk.autoTrade}
            onChange={(e) => onChange({ autoTrade: e.target.checked })}
            className="h-4 w-4 cursor-pointer rounded border-border bg-background accent-[var(--color-accent)]"
          />
          Auto-trade on signals
        </label>
      </CardContent>
    </Card>
  )
}