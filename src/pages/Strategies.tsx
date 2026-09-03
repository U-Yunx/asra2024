/**
 * Strategies — save, browse, delete and reuse strategy configurations. Saving
 * stores to the `strategies` table; "Use in robot" pushes the config into the
 * selected strategy store the trading page reads from localStorage.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, Trash2 } from 'lucide-react'
import type { StrategyConfig } from '../lib/types'
import { useAuth } from '../hooks/useAuth'
import { useSavedStrategies } from '../hooks/useSavedStrategies'
import { DEFAULT_STRATEGY } from '../hooks/useSelectedStrategy'
import { STRATEGY_META } from '../lib/strategies'
import { formatDateTime } from '../lib/format'
import { Button, Card, CardContent, EmptyState, PageHeader } from '../components/ui'
import { StrategyForm } from '../components/StrategyForm'

export function Strategies() {
  const { user } = useAuth()
  const { strategies, loading, save, remove } = useSavedStrategies(user)
  const [strategy, setStrategy] = useState<StrategyConfig>(DEFAULT_STRATEGY)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  const handleSave = async (name: string) => {
    if (!name) return
    setSaving(true)
    await save({
      name,
      pair: strategy.pair,
      strategy_type: strategy.type,
      params: strategy.params,
      timeframe: strategy.interval,
    })
    setSaving(false)
    setSavedFlash(name)
    setTimeout(() => setSavedFlash(null), 2500)
  }

  const useInRobot = (id: string) => {
    const s = strategies.find((x) => x.id === id)
    if (!s) return
    setStrategy({
      pair: s.pair,
      interval: s.timeframe,
      type: s.strategy_type,
      params: s.params,
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Strategies"
        description="Save your favourite configurations and load them into the robot in one click."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <StrategyForm
          strategy={strategy}
          onChange={setStrategy}
          onSave={handleSave}
          saving={saving}
          saveLabel="Save strategy"
        />

        <div className="lg:col-span-2">
          {savedFlash && (
            <p role="status" className="mb-3 rounded-lg border border-up/40 bg-up/10 px-4 py-2 text-sm text-up">
              Saved “{savedFlash}”.
            </p>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading saved strategies…</p>
          ) : strategies.length === 0 ? (
            <EmptyState
              icon={<Bookmark className="h-6 w-6" aria-hidden="true" />}
              title="No saved strategies yet"
              message="Configure a strategy on the left, give it a name and save it here for reuse across the app."
              action={
                <Link to="/backtester">
                  <Button variant="secondary" size="sm">Try the backtester</Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {strategies.map((s) => (
                <Card key={s.id} className="p-4">
                  <CardContent className="space-y-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-foreground">{s.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {s.pair} · {s.timeframe} · {STRATEGY_META[s.strategy_type]?.shortLabel ?? s.strategy_type} ·{' '}
                          {Object.entries(s.params)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(', ')}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground/70">
                          Updated {formatDateTime(s.updated_at ?? s.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => useInRobot(s.id)}>
                          Use in robot
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void remove(s.id)}
                          aria-label={`Delete ${s.name}`}
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}