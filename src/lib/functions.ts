/**
 * Thin wrapper over `supabase.functions.invoke` used by the trading pages and
 * the platform layer. Normalizes the many edge-function response shapes into a
 * single `{ data, error }` result and guards against an unconfigured client so
 * callers never need to know whether Supabase is connected.
 */
import { FunctionsHttpError } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './supabase'

interface InvokeOptions {
  body?: unknown
  /** User-friendly message shown when the call itself fails. */
  fallback?: string
}

interface EdgeErrorShape {
  error?: string
  message?: string
}

export async function fn<T>(
  name: string,
  options: InvokeOptions = {},
): Promise<{ data: T | null; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { data: null, error: options.fallback ?? 'Service not configured.' }
  }
  try {
    const { data, error } = await supabase.functions.invoke(name, {
      body: options.body as string | Record<string, unknown> | undefined,
    })
    if (error) {
      // Non-2xx responses: the edge functions return `{ ok: false, error: "…" }`,
      // so the response body carries the REAL reason (e.g. the broker's own
      // rejection message, like an account the broker has blocked). Prefer it
      // over the generic fallback — otherwise a failed live-account load only
      // ever says "Could not load your MetaTrader account." and hides why.
      if (error instanceof FunctionsHttpError) {
        const body = (await error.context.json().catch(() => null)) as EdgeErrorShape | null
        const real = body?.error ?? body?.message
        if (real) return { data: null, error: real }
      }
      return { data: null, error: options.fallback ?? error.message }
    }
    if (data && typeof data === 'object' && 'error' in (data as object)) {
      const e = (data as EdgeErrorShape).error
      if (e) {
        return { data: null, error: (data as EdgeErrorShape).message ?? e }
      }
    }
    return { data: data as T, error: null }
  } catch {
    return { data: null, error: options.fallback ?? 'Could not reach the service.' }
  }
}