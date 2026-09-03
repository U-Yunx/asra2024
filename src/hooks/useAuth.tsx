/**
 * Auth context for the ANA24 app. Wraps the Supabase auth session and exposes
 * sign-in / sign-out / password-update helpers in a small, typed surface the
 * pages consume. When Supabase isn't configured the context degrades to a
 * signed-out state so the rest of the app never crashes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  updatePassword: (newPassword: string) => Promise<string | null>
  /** Send a password-reset email to the address (Supabase auth). */
  resetPasswordForEmail: (email: string) => Promise<string | null>
  /** True while the user has arrived via a password-recovery link (Supabase
   * fires PASSWORD_RECOVERY). The app should prompt for a new password. */
  isPasswordRecovery: boolean
  /** Clear the password-recovery flag once the user has set a new password. */
  clearRecovery: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  signIn: async () => ({ error: 'Service not configured.' }),
  signOut: async () => {},
  updatePassword: async () => 'Service not configured.',
  resetPasswordForEmail: async () => 'Service not configured.',
  isPasswordRecovery: false,
  clearRecovery: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      // The user clicked a password-recovery link from their email — the
      // session is real but they must set a new password before trading.
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
      setLoading(false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) return { error: 'Service not configured.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut()
    setIsPasswordRecovery(false)
  }, [])

  const updatePassword = useCallback(async (newPassword: string) => {
    if (!isSupabaseConfigured) return 'Service not configured.'
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return error?.message ?? null
  }, [])

  const resetPasswordForEmail = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) return 'Service not configured.'
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    return error?.message ?? null
  }, [])

  const clearRecovery = useCallback(() => setIsPasswordRecovery(false), [])

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, updatePassword, resetPasswordForEmail, isPasswordRecovery, clearRecovery }),
    [user, loading, signIn, signOut, updatePassword, resetPasswordForEmail, isPasswordRecovery, clearRecovery],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}