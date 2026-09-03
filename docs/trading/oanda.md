# OANDA integration

ANA24 supports live trading on OANDA practice and live accounts. The browser
never talks to OANDA directly — all orders route through the `broker-oanda`
Supabase Edge Function, which holds the user's API key as a secret.

## How it works

1. On the **Brokers** page the user pastes their OANDA API token and account
   ID (from OANDA's `v20` practice/live environment).
2. The connection is stored in `broker_connections` with the token encrypted
   server-side (`api_key` is never SELECTed into the browser).
3. A scoped **robot REST API token** is generated server-side
   (`broker-token` Edge Function) and cached briefly in the client.
4. Every `openPosition` / `closePosition` / `markToMarket` on the trading page
   calls `broker-oanda`, which authenticates to OANDA's REST API, places the
   order, and returns an authoritative mirror of the account.

## Setup for developers

- The OANDA REST API base URL is `https://api-fxpractice.oanda.com` (practice)
  or `https://api-fxtrade.oanda.com` (live).
- No OANDA credentials are stored as environment variables in the repo — they
  live per-user in the database, encrypted, and are only read inside the Edge
  Function via the signed-in user's session.

## Rate limits

OANDA rate-limits API calls. The broker adapter keeps order placement
conservative and refreshes the account mirror only when a position changes or
on an explicit refresh.