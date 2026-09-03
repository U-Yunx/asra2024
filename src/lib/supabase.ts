import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client for the ANA24 platform.
 *
 * The URL + anon key are public (safe to ship to the browser) and are wired via
 * `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. All privileged work — broker
 * bridges, payments, market data — happens inside Edge Functions that read real
 * secrets server-side, never here.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : (null as unknown as ReturnType<typeof createClient>)