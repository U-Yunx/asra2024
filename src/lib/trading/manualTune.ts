/**
 * Manual robot tuning profile — a small set of human-friendly knobs that map
 * onto the underlying RiskConfig, with one-click aggressiveness presets.
 *
 * The presets also encode guardrails so the robot stays risk-aware even at
 * higher aggression: adaptive risk (de-risk after a losing streak), a
 * volatility filter (stand aside when the market is wild) and a
 * consecutive-loss circuit breaker. The more aggressive the preset, the fewer
 * guardrails stay on.
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
  /** De-risk position size after consecutive losses (risk-aware sizing). */
  adaptiveRisk: boolean
  /** Stand aside when volatility (ATR) is spiking. */
  volatilityFilter: boolean
  /** Consecutive-loss circuit breaker (0 = off). */
  maxConsecutiveLosses: number
}

export const MANUAL_TUNE_DEFAULTS: ManualTune = {
  aggressiveness: 3,
  targetProfitPct: 2,
  sizeMultiplier: 1,
  riskPerTradePct: 1,
  takeProfitRatio: 2,
  maxOpenPositions: 5,
  maxDailyLossPct: 5,
  adaptiveRisk: true,
  volatilityFilter: false,
  maxConsecutiveLosses: 5,
}

/** Presets by aggressiveness level (1 = conservative … 5 = extreme). */
export const MANUAL_TUNE_PRESETS: Record<Aggressiveness, Omit<ManualTune, 'aggressiveness'>> = {
  1: { targetProfitPct: 0.5, sizeMultiplier: 0.5, riskPerTradePct: 0.5, takeProfitRatio: 3, maxOpenPositions: 2, maxDailyLossPct: 2, adaptiveRisk: true, volatilityFilter: true, maxConsecutiveLosses: 3 },
  2: { targetProfitPct: 1, sizeMultiplier: 0.75, riskPerTradePct: 0.75, takeProfitRatio: 2.5, maxOpenPositions: 3, maxDailyLossPct: 3, adaptiveRisk: true, volatilityFilter: true, maxConsecutiveLosses: 4 },
  3: { targetProfitPct: 2, sizeMultiplier: 1, riskPerTradePct: 1, takeProfitRatio: 2, maxOpenPositions: 5, maxDailyLossPct: 5, adaptiveRisk: true, volatilityFilter: false, maxConsecutiveLosses: 5 },
  4: { targetProfitPct: 3, sizeMultiplier: 1.5, riskPerTradePct: 1.5, takeProfitRatio: 1.5, maxOpenPositions: 7, maxDailyLossPct: 8, adaptiveRisk: false, volatilityFilter: false, maxConsecutiveLosses: 6 },
  5: { targetProfitPct: 5, sizeMultiplier: 2, riskPerTradePct: 2, takeProfitRatio: 1, maxOpenPositions: 10, maxDailyLossPct: 12, adaptiveRisk: false, volatilityFilter: false, maxConsecutiveLosses: 0 },
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

/** Short description of the guardrails a preset enables (for the UI). */
export function guardrailLabel(
  tune: Pick<ManualTune, 'adaptiveRisk' | 'volatilityFilter' | 'maxConsecutiveLosses'>,
): string {
  const parts: string[] = []
  if (tune.adaptiveRisk) parts.push('adaptive risk')
  if (tune.volatilityFilter) parts.push('volatility filter')
  if (tune.maxConsecutiveLosses > 0) parts.push(`${tune.maxConsecutiveLosses}-loss breaker`)
  return parts.length > 0 ? parts.join(' · ') : 'no guardrails'
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
