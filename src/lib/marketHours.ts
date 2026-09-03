/**
 * Rough market-open check used for sorting and badges. Crypto trades 24/7;
 * forex follows the standard 22:00 UTC Sunday open → 21:00 UTC Friday close.
 */

/** True when the symbol is a crypto pair (24/7). */
function isCrypto(symbol: string): boolean {
  return /BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC/.test(symbol)
}

export function isPairOpen(symbol: string): boolean {
  if (isCrypto(symbol)) return true
  const now = new Date()
  const day = now.getUTCDay()
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60
  // Sunday before 22:00 UTC is still closed.
  if (day === 0) return hour >= 22
  // Friday after 21:00 UTC is closed for the weekend.
  if (day === 5) return hour < 21
  // Saturday is fully closed.
  if (day === 6) return false
  return true
}