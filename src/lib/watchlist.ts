/**
 * The canonical watchlist — every symbol the market-data Edge Function quotes
 * and the robot can trade. Must stay in sync with `market-data/index.ts`.
 */

export interface WatchlistPair {
  symbol: string
  name: string
}

export const WATCHLIST: WatchlistPair[] = [
  { symbol: 'EUR/USD', name: 'Euro / US Dollar' },
  { symbol: 'GBP/USD', name: 'British Pound / US Dollar' },
  { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen' },
  { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc' },
  { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar' },
  { symbol: 'NZD/USD', name: 'New Zealand Dollar / US Dollar' },
  { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar' },
  { symbol: 'EUR/GBP', name: 'Euro / British Pound' },
  { symbol: 'EUR/JPY', name: 'Euro / Japanese Yen' },
  { symbol: 'GBP/JPY', name: 'British Pound / Japanese Yen' },
  { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar' },
  { symbol: 'ETH/USD', name: 'Ethereum / US Dollar' },
  { symbol: 'BNB/USD', name: 'BNB / US Dollar' },
  { symbol: 'SOL/USD', name: 'Solana / US Dollar' },
  { symbol: 'XRP/USD', name: 'XRP / US Dollar' },
  { symbol: 'ADA/USD', name: 'Cardano / US Dollar' },
  { symbol: 'DOGE/USD', name: 'Dogecoin / US Dollar' },
  { symbol: 'LTC/USD', name: 'Litecoin / US Dollar' },
]

export function isCryptoPair(symbol: string): boolean {
  return /BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC/.test(symbol)
}

export function pairBySymbol(symbol: string): WatchlistPair | null {
  return WATCHLIST.find((p) => p.symbol === symbol) ?? null
}