/**
 * ManualTunePanel — the one-click tuning card. Five aggressiveness presets
 * (conservative → extreme) map onto risk + sizing knobs and risk guardrails
 * (adaptive risk, volatility filter, consecutive-loss breaker); individual
 * fields can be fine-tuned below. "Apply" pushes the profile onto the live
 * risk config.
 */
import { Check, RotateCcw, ShieldCheck, Sliders, Sparkles } from 'lucide-react'
import type { Aggressiveness, ManualTune } from '../../lib/trading/manualTune'
import { aggressivenessLabel, guardrailLabel } from '../../lib/trading/manualTune'
import { cn } from '../../lib/cn'
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '../ui'

const LEVELS: Aggressiveness[] = [1, 2, 3, 4, 5]

export function ManualTunePanel({
  tune,
  onUpdate,
  onApplyPreset,
  onReset,
  onApply,
  applied,
}: {
  tune: ManualTune
  onUpdate: (patch: Partial<ManualTune>) => void
  onApplyPreset: (level: Aggressiveness) => void
  onReset: () => void
  onApply: () => void
  applied: boolean
}) {
  return (
    <Card className="border-accent/30 bg-accent/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-accent" aria-hidden="true" />
          Manual tune
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </Button>
          <Button size="sm" onClick={onApply}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Apply
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Aggressiveness</span>
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="Aggressiveness preset">
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onApplyPreset(level)}
                aria-pressed={tune.aggressiveness === level}
                className={cn(
                  'cursor-pointer rounded-lg border px-2 py-2 text-center transition-colors duration-150',
                  tune.aggressiveness === level
                    ? 'border-accent bg-accent/20 text-accent'
                    : 'border-border bg-background/50 text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="block text-lg font-bold">{level}</span>
                <span className="block text-[10px] uppercase tracking-wide">{aggressivenessLabel(level)}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Guardrails on this preset: <span className="text-foreground">{guardrailLabel(tune)}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input
            label="Target profit"
            type="number"
            min={0}
            step={0.5}
            value={tune.targetProfitPct}
            onChange={(e) => onUpdate({ targetProfitPct: Number(e.target.value) })}
          />
          <Input
            label="Size multiplier"
            type="number"
            min={0.25}
            step={0.25}
            value={tune.sizeMultiplier}
            onChange={(e) => onUpdate({ sizeMultiplier: Number(e.target.value) })}
          />
          <Input
            label="Risk per trade"
            type="number"
            min={0}
            step={0.25}
            value={tune.riskPerTradePct}
            onChange={(e) => onUpdate({ riskPerTradePct: Number(e.target.value) })}
          />
          <Input
            label="Risk:reward"
            type="number"
            min={0.5}
            step={0.5}
            value={tune.takeProfitRatio}
            onChange={(e) => onUpdate({ takeProfitRatio: Number(e.target.value) })}
          />
          <Input
            label="Max positions"
            type="number"
            min={1}
            step={1}
            value={tune.maxOpenPositions}
            onChange={(e) => onUpdate({ maxOpenPositions: Number(e.target.value) })}
          />
          <Input
            label="Daily loss limit"
            type="number"
            min={0}
            step={1}
            value={tune.maxDailyLossPct}
            onChange={(e) => onUpdate({ maxDailyLossPct: Number(e.target.value) })}
          />
        </div>

        <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
          <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-up" aria-hidden="true" />
            Risk guardrails
          </span>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={tune.adaptiveRisk}
                onChange={(e) => onUpdate({ adaptiveRisk: e.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border bg-background accent-[var(--color-accent)]"
              />
              <span>
                <span className="block font-medium">Adaptive risk</span>
                <span className="text-muted-foreground">Trade smaller after consecutive losses.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={tune.volatilityFilter}
                onChange={(e) => onUpdate({ volatilityFilter: e.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border bg-background accent-[var(--color-accent)]"
              />
              <span>
                <span className="block font-medium">Volatility filter</span>
                <span className="text-muted-foreground">Stand aside when ATR spikes.</span>
              </span>
            </label>
            <div className="sm:col-span-2">
              <Input
                label="Losses before stand-down (0 = off)"
                type="number"
                min={0}
                max={10}
                step={1}
                value={tune.maxConsecutiveLosses}
                onChange={(e) => onUpdate({ maxConsecutiveLosses: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </div>
          </div>
        </div>

        {applied && (
          <p role="status" className="mt-3 flex items-center gap-1.5 rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Manual tune applied to the risk profile.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
