/**
 * Auth — sign in / create account against Supabase auth. When Supabase isn't
 * configured, shows a helpful message instead of a broken form. On success
 * redirects to the page the visitor originally tried to reach (or /trading).
 */
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Database, KeyRound, LogIn, UserPlus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '../components/ui'

export function Auth() {
  const { user, loading, signIn, updatePassword, resetPasswordForEmail, isPasswordRecovery, clearRecovery } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/trading'

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'newpassword'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Already signed in and not recovering a password? Send them to the app.
  if (!loading && user && !isPasswordRecovery) {
    navigate(from, { replace: true })
    return null
  }

  // A user who clicked the recovery link in their email lands here with a real
  // session but must choose a new password first.
  const recoveryActive = isPasswordRecovery && !!user

  const submit = async () => {
    if (recoveryActive || mode === 'newpassword') {
      if (password.length < 6) {
        setError('Your new password needs at least 6 characters.')
        return
      }
      if (password !== confirmPassword) {
        setError("The two passwords don't match — try again.")
        return
      }
      setBusy(true)
      setError(null)
      setInfo(null)
      const err = await updatePassword(password)
      setBusy(false)
      if (err) {
        setError(err)
        return
      }
      setInfo("Password updated — you're all set. Sign in with your new password.")
      setMode('signin')
      setPassword('')
      setConfirmPassword('')
      clearRecovery()
      return
    }
    if (mode === 'forgot') {
      if (!email.trim()) {
        setError('Enter the email address for your account.')
        return
      }
      setBusy(true)
      setError(null)
      setInfo(null)
      const err = await resetPasswordForEmail(email.trim())
      setBusy(false)
      if (err) {
        setError(err)
        return
      }
      setInfo('Check your inbox — we sent a link to reset your password.')
      return
    }
    if (!email.trim() || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters.')
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    if (mode === 'signin') {
      const { error: signInError } = await signIn(email.trim(), password)
      setBusy(false)
      if (signInError) {
        setError(
          signInError.toLowerCase().includes('invalid login')
            ? 'That email/password combination is wrong — check and try again.'
            : signInError,
        )
        return
      }
      navigate(from, { replace: true })
      return
    }
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (signUpError) {
      setError(signUpError.message)
      return
    }
    setInfo('Account created! Check your inbox to confirm your email, then sign in.')
    setMode('signin')
  }

  const switchMode = (next: 'signin' | 'signup' | 'forgot') => {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  const title =
    recoveryActive || mode === 'newpassword'
      ? 'Set a new password'
      : mode === 'forgot'
        ? 'Reset your password'
        : mode === 'signin'
          ? 'Welcome back'
          : 'Create your account'

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader className="mb-2">
          <CardTitle className="text-xl">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {!isSupabaseConfigured && (
            <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">Authentication is not configured yet</p>
                <p className="mt-1">
                  Link a Supabase project to enable sign-in. You'll be able to create an account as
                  soon as it's connected.
                </p>
              </div>
            </div>
          )}

          {isSupabaseConfigured && (
            <>
              {(recoveryActive || mode === 'newpassword') && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm">
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                  <p className="text-foreground">
                    Hi {user?.email ?? 'there'} — choose a new password to finish recovering your account.
                  </p>
                </div>
              )}

              {!recoveryActive && mode !== 'newpassword' && mode !== 'forgot' && (
                <div className="mb-4 grid grid-cols-2 gap-2" role="tablist" aria-label="Auth mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signin'}
                    onClick={() => switchMode('signin')}
                    className={
                      mode === 'signin'
                        ? 'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-accent bg-accent/15 px-3 py-2 text-sm font-semibold text-accent'
                        : 'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground'
                    }
                  >
                    <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signup'}
                    onClick={() => switchMode('signup')}
                    className={
                      mode === 'signup'
                        ? 'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-accent bg-accent/15 px-3 py-2 text-sm font-semibold text-accent'
                        : 'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground'
                    }
                  >
                    <UserPlus className="h-4 w-4" aria-hidden="true" /> Create account
                  </button>
                </div>
              )}

              <div className="space-y-3">
                {mode !== 'forgot' && !recoveryActive && mode !== 'newpassword' && (
                  <Input
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                )}
                {(mode === 'forgot') && (
                  <Input
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                )}
                {mode === 'signin' || mode === 'signup' ? (
                  <Input
                    label="Password"
                    type="password"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                ) : null}
                {(recoveryActive || mode === 'newpassword') && (
                  <>
                    <Input
                      label="New password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                    />
                    <Input
                      label="Confirm new password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat your new password"
                    />
                  </>
                )}
              </div>

              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="mt-2 cursor-pointer text-xs text-accent hover:underline"
                >
                  Forgot your password?
                </button>
              )}
              {mode === 'forgot' && (
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="mt-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Back to sign in
                </button>
              )}

              {error && (
                <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              {info && (
                <p role="status" className="mt-3 rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
                  {info}
                </p>
              )}

              <Button className="mt-4 w-full" size="lg" loading={busy} onClick={() => void submit()}>
                {recoveryActive || mode === 'newpassword' ? (
                  <>
                    <KeyRound className="h-4 w-4" aria-hidden="true" /> Set new password
                  </>
                ) : mode === 'forgot' ? (
                  'Send reset link'
                ) : mode === 'signin' ? (
                  'Sign in'
                ) : (
                  'Create account'
                )}
              </Button>

              {mode !== 'forgot' && !recoveryActive && mode !== 'newpassword' && (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  By continuing you agree to trade at your own risk. Paper trading is free and requires
                  no card.
                </p>
              )}
            </>
          )}

          <div className="mt-4 text-center text-sm text-muted-foreground">
            Need help? <Link to="/help" className="text-accent hover:underline">Read the FAQ</Link>.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}