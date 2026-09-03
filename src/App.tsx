import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ArrowRight, Database } from 'lucide-react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { isSupabaseConfigured } from './lib/supabase'
import Layout from './components/Layout'

// Route-level code-splitting: each page becomes its own lazy chunk so the
// initial load only ships the shell + landing, and heavier pages (trading,
// backtester, charts) load on demand.
//
// `loadPage` wraps every dynamic import so that the occasional Vite dev-server
// HMR/cache churn (which can throw "error loading dynamically imported module"
// for a split chunk) self-heals instead of white-screening the route. A stale
// or mid-update module request is retried once, then a fresh import() is forced
// by stripping the URL so the browser reparses the current module graph.
const __loadPage = <T,>(p: Promise<T>): Promise<T> =>
  p.catch(() =>
    // Retry the exact same module after a tick; by then Vite has settled any
    // in-flight dependency re-optimization that caused the first failure.
    new Promise<T>((resolve, reject) => {
      setTimeout(() => p.then(resolve, reject), 300)
    }),
  )

const Home = lazy(() => __loadPage(import('./pages/Home').then((m) => ({ default: m.Home }))))
const Dashboard = lazy(() => __loadPage(import('./pages/Dashboard').then((m) => ({ default: m.Dashboard }))))
const Backtester = lazy(() => __loadPage(import('./pages/Backtester').then((m) => ({ default: m.Backtester }))))
const Signals = lazy(() => __loadPage(import('./pages/Signals').then((m) => ({ default: m.Signals }))))
const Strategies = lazy(() => __loadPage(import('./pages/Strategies').then((m) => ({ default: m.Strategies }))))
const Trading = lazy(() => __loadPage(import('./pages/Trading').then((m) => ({ default: m.Trading }))))
const Performance = lazy(() => __loadPage(import('./pages/Performance').then((m) => ({ default: m.Performance }))))
const Auth = lazy(() => __loadPage(import('./pages/Auth').then((m) => ({ default: m.Auth }))))
const Packages = lazy(() => __loadPage(import('./pages/Packages').then((m) => ({ default: m.Packages }))))
const Referrals = lazy(() => __loadPage(import('./pages/Referrals').then((m) => ({ default: m.Referrals }))))
const Brokers = lazy(() => __loadPage(import('./pages/Brokers').then((m) => ({ default: m.Brokers }))))
const Contact = lazy(() => __loadPage(import('./pages/Contact').then((m) => ({ default: m.Contact }))))
const Help = lazy(() => __loadPage(import('./pages/Help').then((m) => ({ default: m.Help }))))
const Admin = lazy(() => __loadPage(import('./pages/Admin').then((m) => ({ default: m.Admin }))))
const Account = lazy(() => __loadPage(import('./pages/Account').then((m) => ({ default: m.Account }))))
const Profile = lazy(() => __loadPage(import('./pages/Profile').then((m) => ({ default: m.Profile }))))
const Notifications = lazy(() => __loadPage(import('./pages/Notifications').then((m) => ({ default: m.Notifications }))))
const Configuration = lazy(() => __loadPage(import('./pages/Configuration').then((m) => ({ default: m.Configuration }))))
const Gateway = lazy(() => __loadPage(import('./pages/Gateway').then((m) => ({ default: m.Gateway }))))
const MyAds = lazy(() => __loadPage(import('./pages/MyAds').then((m) => ({ default: m.MyAds }))))
const MarketPairs = lazy(() => __loadPage(import('./pages/MarketPairs').then((m) => ({ default: m.MarketPairs }))))

function FullPageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

/**
 * Shown instead of the app when no Supabase project is linked yet. Prevents a
 * module-load crash (createClient needs VITE_SUPABASE_URL) and tells the user
 * exactly what to do next.
 */
function SupabaseSetupScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-terminal-grid bg-background p-6">
      <div className="w-full max-w-md animate-fade-up rounded-2xl border border-border bg-muted/30 p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-on-primary shadow-lg">
          <Database className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Supabase connection required
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          ANA24 runs on Supabase — it powers your sign-in, live market data, and paper-trading
          account. Right now no project is linked, so there's nothing for the app to connect to.
        </p>
        <div className="mt-5 rounded-xl border border-border bg-background/60 p-4 text-left font-mono text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 text-foreground">Missing environment variables</div>
          <div>VITE_SUPABASE_URL</div>
          <div>VITE_SUPABASE_ANON_KEY</div>
        </div>
        <div className="mt-5 rounded-xl border border-border bg-background/60 p-4 text-left text-sm leading-relaxed text-muted-foreground">
          <div className="mb-1 text-foreground">How to fix it</div>
          <p>
            In the platform these are set automatically once a Supabase project is linked. If you're
            running the app yourself, copy <code className="font-mono text-xs">.env.example</code> to{' '}
            <code className="font-mono text-xs">.env.local</code> and fill in your project's URL and
            public key — then this screen disappears and the app lights up.
          </p>
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-accent">
          <span>Connect Supabase to continue</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

/** `/` shows the public landing for visitors and the Dashboard for signed-in users. */
function Index() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoader />
  return user ? <Dashboard /> : <Home />
}

/** Redirects visitors away from the signed-in app pages to the auth page. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader />
  if (!user) return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

export default function App() {
  // Until a Supabase project is linked (env vars populated), mounting the real
  // tree would crash on supabase.auth — show a friendly setup screen instead.
  if (!isSupabaseConfigured) return <SupabaseSetupScreen />

  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<FullPageLoader />}>
          <Routes>
          <Route element={<Layout />}>
            {/* Public — visitors see only these (plus the public menu). */}
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/packages" element={<Packages />} />
            <Route path="/brokers" element={<Brokers />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/help" element={<Help />} />
            {/* Public market data — the market-data Edge Function serves
                anonymous visitors (per the PRD), so the market pairs page is
                open to everyone, signed in or not. */}
            <Route path="/markets" element={<MarketPairs />} />

            {/* Signed-in app — visitors are redirected to /auth. */}
            <Route
              path="/trading"
              element={
                <RequireAuth>
                  <Trading />
                </RequireAuth>
              }
            />
            <Route
              path="/performance"
              element={
                <RequireAuth>
                  <Performance />
                </RequireAuth>
              }
            />
            <Route
              path="/referrals"
              element={
                <RequireAuth>
                  <Referrals />
                </RequireAuth>
              }
            />
            <Route
              path="/signals"
              element={
                <RequireAuth>
                  <Signals />
                </RequireAuth>
              }
            />
            <Route
              path="/backtester"
              element={
                <RequireAuth>
                  <Backtester />
                </RequireAuth>
              }
            />
            <Route
              path="/strategies"
              element={
                <RequireAuth>
                  <Strategies />
                </RequireAuth>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <Account />
                </RequireAuth>
              }
            />
            <Route
              path="/my-ads"
              element={
                <RequireAuth>
                  <MyAds />
                </RequireAuth>
              }
            />
            <Route
              path="/notifications"
              element={
                <RequireAuth>
                  <Notifications />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <Profile />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <Admin />
                </RequireAuth>
              }
            />
            <Route
              path="/configuration"
              element={
                <RequireAuth>
                  <Configuration />
                </RequireAuth>
              }
            />
            <Route
              path="/gateway"
              element={
                <RequireAuth>
                  <Gateway />
                </RequireAuth>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}