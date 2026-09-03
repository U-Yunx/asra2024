/**
 * Paper-account persistence.
 *
 * Signed-in users get their account backed up to Supabase (owner-scoped RLS);
 * anonymous visitors fall back to localStorage. Live OANDA / MetaTrader mirrors
 * are never persisted here — their authoritative state always comes from the
 * broker bridge (see usePaperAccount).
 */
import type { User } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { createAccount } from './engine'
import { DEFAULT_RISK } from './types'
import type { AccountState, ClosedTrade, Position, RiskConfig } from './types'

const LOCAL_KEY = 'fx-toolkit.paper-account'

/* --------------------------------- local --------------------------------- */

export function loadLocal(): AccountState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AccountState
    if (!parsed || typeof parsed.balance !== 'number' || !Array.isArray(parsed.positions)) return null
    return { ...parsed, risk: { ...DEFAULT_RISK, ...(parsed.risk ?? {}) } }
  } catch {
    return null
  }
}

export function saveLocal(account: AccountState): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(account))
  } catch {
    /* storage full / blocked — non-fatal */
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    /* noop */
  }
}

/* --------------------------------- remote -------------------------------- */

interface PaperAccountRow {
  id: string
  user_id: string
  broker: string
  currency: string
  initial_balance: number
  balance: number
  risk: RiskConfig | null
  created_at: string | null
  updated_at: string | null
}

interface PaperTradeRow {
  id: string
  user_id: string
  symbol: string
  side: 'long' | 'short'
  status: 'open' | 'closed'
  quantity: number
  entry_price: number
  entry_time: string
  exit_price: number | null
  exit_time: string | null
  stop_loss: number | null
  take_profit: number | null
  pnl: number | null
  pnl_pct: number | null
  entry_equity: number | null
  close_reason: string | null
  strategy: string | null
  created_at: string | null
}

function toRow(account: AccountState, userId: string): {
  account: Omit<PaperAccountRow, 'id' | 'created_at' | 'updated_at'>
  trades: PaperTradeRow[]
} {
  const trades: PaperTradeRow[] = [
    ...account.positions.map<PaperTradeRow>((p) => ({
      id: p.id,
      user_id: userId,
      symbol: p.symbol,
      side: p.side,
      status: 'open',
      quantity: p.units,
      entry_price: p.entryPrice,
      entry_time: p.entryTime,
      exit_price: null,
      exit_time: null,
      stop_loss: p.stopPrice,
      take_profit: p.takeProfitPrice,
      pnl: null,
      pnl_pct: null,
      entry_equity: p.entryEquity,
      close_reason: null,
      strategy: p.strategy ?? null,
      created_at: null,
    })),
    ...account.trades.map<PaperTradeRow>((t) => ({
      id: t.id,
      user_id: userId,
      symbol: t.symbol,
      side: t.side,
      status: 'closed',
      quantity: t.units,
      entry_price: t.entryPrice,
      entry_time: t.entryTime,
      exit_price: t.exitPrice,
      exit_time: t.exitTime,
      stop_loss: t.stopPrice,
      take_profit: t.takeProfitPrice,
      pnl: t.pnl,
      pnl_pct: t.pnlPct,
      entry_equity: t.entryEquity,
      close_reason: t.closeReason,
      strategy: t.strategy ?? null,
      created_at: null,
    })),
  ]
  return {
    account: {
      user_id: userId,
      broker: account.broker,
      currency: account.currency,
      initial_balance: account.initialBalance,
      balance: account.balance,
      risk: account.risk,
    },
    trades,
  }
}

function fromRows(row: PaperAccountRow, trades: PaperTradeRow[]): AccountState {
  const positions: Position[] = []
  const closed: ClosedTrade[] = []
  for (const t of trades) {
    if (t.status === 'open') {
      positions.push({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        units: t.quantity,
        entryPrice: t.entry_price,
        entryTime: t.entry_time,
        stopPrice: t.stop_loss ?? 0,
        takeProfitPrice: t.take_profit ?? 0,
        entryEquity: t.entry_equity ?? Number(row.balance ?? 0),
        strategy: t.strategy ?? undefined,
        status: 'open',
      })
    } else {
      closed.push({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        units: t.quantity,
        entryPrice: t.entry_price,
        entryTime: t.entry_time,
        exitPrice: t.exit_price ?? t.entry_price,
        exitTime: t.exit_time ?? t.entry_time,
        stopPrice: t.stop_loss ?? 0,
        takeProfitPrice: t.take_profit ?? 0,
        entryEquity: t.entry_equity ?? Number(row.balance ?? 0),
        pnl: t.pnl ?? 0,
        pnlPct: t.pnl_pct ?? 0,
        closeReason: (t.close_reason as ClosedTrade['closeReason']) ?? 'manual',
        strategy: t.strategy ?? undefined,
        status: 'closed',
      })
    }
  }
  return {
    id: row.id,
    broker: (row.broker as AccountState['broker']) ?? 'paper',
    currency: (row.currency as AccountState['currency']) ?? 'USD',
    initialBalance: Number(row.initial_balance ?? 0),
    balance: Number(row.balance ?? 0),
    risk: { ...DEFAULT_RISK, ...(row.risk ?? {}) },
    positions,
    trades: closed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Load the signed-in user's account from Supabase (null when none exists). */
export async function loadRemote(user: User): Promise<AccountState | null> {
  try {
    const { data: acct } = await supabase
      .from('paper_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!acct) return null
    const { data: trades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    return fromRows(acct as unknown as PaperAccountRow, (trades as unknown as PaperTradeRow[]) ?? [])
  } catch {
    return null
  }
}

/** Replace the signed-in user's account (and all its trades) in Supabase. */
export async function saveRemote(user: User, account: AccountState): Promise<void> {
  try {
    const { account: accRow, trades } = toRow(account, user.id)
    await supabase.from('paper_accounts').upsert(accRow, { onConflict: 'user_id' })
    await supabase.from('paper_trades').delete().eq('user_id', user.id)
    if (trades.length > 0) {
      await supabase.from('paper_trades').insert(trades)
    }
  } catch {
    /* best-effort — local copy still exists */
  }
}

/** Wipe the Supabase mirror and seed a fresh account at the given balance. */
export async function resetRemote(user: User, initialBalance: number): Promise<void> {
  try {
    await supabase.from('paper_trades').delete().eq('user_id', user.id)
    await supabase.from('paper_accounts').delete().eq('user_id', user.id)
    const fresh = createAccount(initialBalance)
    await supabase.from('paper_accounts').insert({
      user_id: user.id,
      broker: fresh.broker,
      currency: fresh.currency,
      initial_balance: fresh.initialBalance,
      balance: fresh.balance,
      risk: fresh.risk,
    })
  } catch {
    /* best-effort */
  }
}
