/**
 * Manual robot tuning profile — a small set of human-friendly knobs that map
 * onto the underlying RiskConfig, with one-click aggressiveness presets.
 */
import { useCallback, useState } from 'react'

export type Aggressiveness = 1 | 2 | 3 | 4 | 5

export interface ManualTune {
  aggressiveness: Aggressiveness
  /** Per-run target profit, % of starting equity. */
  targetProfitPct: number
  /** Multiplier applied to the risk-based position size. */
  sizeMultiplier: number
  riskPerTradePct: number
  takeProfitRatio: number
  maxOpenPositions: number
  maxDailyLossPct: number
}

export const MANUAL_TUNE_DEFAULTS: ManualTune = {
  aggressiveness: 3,
  targetProfitPct: 2,
  sizeMultiplier: 1,
  riskPerTradePct: 1,
  takeProfitRatio: 2,
  maxOpenPositions: 5,
  maxDailyLossPct: 5,
}

/** Presets by aggressiveness level (1 = conservative … 5 = extreme). */
export const MANUAL_TUNE_PRESETS: Record<Aggressiveness, Omit<ManualTune, 'aggressiveness'>> = {
  1: { targetProfitPct: 0.5, sizeMultiplier: 0.5, riskPerTradePct: 0.5, takeProfitRatio: 3, maxOpenPositions: 2, maxDailyLossPct: 2 },
  2: { targetProfitPct: 1, sizeMultiplier: 0.75, riskPerTradePct: 0.75, takeProfitRatio: 2.5, maxOpenPositions: 3, maxDailyLossPct: 3 },
  3: { targetProfitPct: 2, sizeMultiplier: 1, riskPerTradePct: 1, takeProfitRatio: 2, maxOpenPositions: 5, maxDailyLossPct: 5 },
  4: { targetProfitPct: 3, sizeMultiplier: 1.5, riskPerTradePct: 1.5, takeProfitRatio: 1.5, maxOpenPositions: 7, maxDailyLossPct: 8 },
  5: { targetProfitPct: 5, sizeMultiplier: 2, riskPerTradePct: 2, takeProfitRatio: 1, maxOpenPositions: 10, maxDailyLossPct: 12 },
}

export function aggressivenessLabel(level: Aggressiveness): string {
  switch (level) {
    case 1:
      return 'Conservative'
    case 2:
      return 'Cautious'
    case 3:
      return 'Balanced'
    case 4:
      return 'Aggressive'
    case 5:
      return 'Extreme'
  }
}

export function useManualTune() {
  const [tune, setTune] = useState<ManualTune>(MANUAL_TUNE_DEFAULTS)

  const update = useCallback((patch: Partial<ManualTune>) => {
    setTune((prev) => ({ ...prev, ...patch }))
  }, [])

  const applyPreset = useCallback((level: Aggressiveness) => {
    setTune({ aggressiveness: level, ...MANUAL_TUNE_PRESETS[level] })
  }, [])

  const reset = useCallback(() => {
    setTune(MANUAL_TUNE_DEFAULTS)
  }, [])

  return { tune, update, applyPreset, reset }
}