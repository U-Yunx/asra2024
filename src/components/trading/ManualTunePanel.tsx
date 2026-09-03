/**
 * ManualTunePanel — the one-click tuning card. Five aggressiveness presets
 * (conservative → extreme) map onto risk + sizing knobs; individual fields can
 * be fine-tuned below. "Apply" pushes the profile onto the live risk config.
 */
import { Check, RotateCcw, Sliders, Sparkles } from 'lucide-react'
import type { Aggressiveness, ManualTune } from '../../lib/trading/manualTune'
import { aggressivenessLabel } from '../../lib/trading/manualTune'
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
                  'cursor-pointer rounded-lg border px-2 py-2 text-center',
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