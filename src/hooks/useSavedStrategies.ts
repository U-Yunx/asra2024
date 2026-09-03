/**
 * Saved strategies for the signed-in user (Strategies page). Backed by the
 * `strategies` table; degrades to a no-op list when Supabase isn't configured.
 */
import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Interval, StrategyParams, StrategyType } from '../lib/types'

export interface SavedStrategyRecord {
  id: string
  user_id: string
  name: string
  pair: string
  strategy_type: StrategyType
  params: StrategyParams
  timeframe: Interval
  created_at: string
  updated_at: string
}

export function useSavedStrategies(user: User | null) {
  const [strategies, setStrategies] = useState<SavedStrategyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !isSupabaseConfigured) {
      setStrategies([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
      setStrategies([])
    } else {
      setStrategies((data ?? []) as SavedStrategyRecord[])
      setError(null)
    }
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(
    async (input: { name: string; pair: string; strategy_type: StrategyType; params: StrategyParams; timeframe: Interval }) => {
      if (!user || !isSupabaseConfigured) return { error: 'Sign in to save strategies.' as string | null }
      const { data, error } = await supabase
        .from('strategies')
        .insert({ user_id: user.id, ...input })
        .select('*')
        .maybeSingle()
      if (!error && data) setStrategies((prev) => [data as SavedStrategyRecord, ...prev])
      return { error: error?.message ?? null }
    },
    [user?.id],
  )

  const remove = useCallback(
    async (id: string) => {
      if (!user || !isSupabaseConfigured) return
      await supabase.from('strategies').delete().eq('id', id).eq('user_id', user.id)
      setStrategies((prev) => prev.filter((s) => s.id !== id))
    },
    [user?.id],
  )

  return { strategies, loading, error, refresh, save, remove }
}