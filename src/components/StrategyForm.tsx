/**
 * StrategyForm — the strategy configuration editor shared by the Strategies
 * page and Backtester. Lets the user pick pair, timeframe and strategy type,
 * then tune that type's parameters. Fires `onChange` with a full StrategyConfig.
 */
import { useMemo, useState } from 'react'
import { Save } from 'lucide-react'
import type { Interval, StrategyConfig } from '../lib/types'
import { INTERVALS, STRATEGY_META, STRATEGY_TYPES } from '../lib/strategies'
import { WATCHLIST } from '../lib/watchlist'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from './ui'

interface Props {
  strategy: StrategyConfig
  onChange: (next: StrategyConfig) => void
  onSave?: (name: string) => void
  saving?: boolean
  saveLabel?: string
}

export function StrategyForm({ strategy, onChange, onSave, saving, saveLabel }: Props) {
  const meta = STRATEGY_META[strategy.type]
  const paramDefs = useMemo(() => Object.keys(meta.defaultParams), [meta])
  const [name, setName] = useState('')

  const setParam = (key: string, value: number) => {
    onChange({ ...strategy, params: { ...strategy.params, [key]: value } })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Strategy</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Pair"
            value={strategy.pair}
            onChange={(e) => onChange({ ...strategy, pair: e.target.value })}
          >
            {WATCHLIST.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.symbol} — {p.name}
              </option>
            ))}
          </Select>
          <Select
            label="Timeframe"
            value={strategy.interval}
            onChange={(e) => onChange({ ...strategy, interval: e.target.value as Interval })}
          >
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
          <Select
            label="Strategy"
            value={strategy.type}
            onChange={(e) => onChange({ ...strategy, type: e.target.value as StrategyConfig['type'] })}
          >
            {STRATEGY_TYPES.map((t) => (
              <option key={t} value={t}>
                {STRATEGY_META[t].name}
              </option>
            ))}
          </Select>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">{meta.description}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {paramDefs.map((key) => (
            <Input
              key={key}
              label={key}
              type="number"
              min={1}
              step={1}
              value={strategy.params[key] ?? meta.defaultParams[key]}
              onChange={(e) => setParam(key, Number(e.target.value))}
            />
          ))}
        </div>

        {onSave && (
          <div className="mt-4 flex items-end gap-2">
            <Input
              id="strategy-name"
              label="Name"
              placeholder={meta.shortLabel}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
            />
            <Button loading={saving} onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {saveLabel ?? 'Save'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}