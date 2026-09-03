/**
 * MarketPairs — public market-data page. Live watchlist quotes for everyone
 * (signed in or not), served by the market-data Edge Function.
 */
import { useQuotes } from '../hooks/useMarketData'
import { PageHeader, Skeleton } from '../components/ui'
import { MarketStatus } from '../components/MarketStatus'
import { MarketPairsTable } from '../components/MarketPairsTable'

export function MarketPairs() {
  const { quotes, loading, error, kind } = useQuotes(15_000)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market pairs"
        description="Live prices for the forex and crypto watchlist the robot trades. Data updates in real time."
      />

      <MarketStatus quotes={quotes} />

      {kind !== 'ok' ? (
        <p role="alert" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {error ?? 'Market data is temporarily unavailable.'}
        </p>
      ) : loading && !quotes ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <MarketPairsTable quotes={quotes} />
      )}
    </div>
  )
}
