/**
 * Help — a small FAQ covering the essentials: paper trading, the robot, risk
 * controls, packages and payouts. Links out to Contact for anything deeper.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, HelpCircle } from 'lucide-react'
import { cn } from '../lib/cn'
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '../components/ui'

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is paper trading?',
    a: 'Paper trading runs the robot on a simulated account with virtual USD — no real money, no risk. Every signed-in user gets a free $10,000 paper account to practice on.',
  },
  {
    q: 'How does the trading robot work?',
    a: 'The robot applies a strategy (Moving Average, RSI, MACD or Bollinger) to live price bars, reads buy/sell signals, and opens positions sized by your risk limits. It respects max open positions, per-trade risk, trailing stops and your daily loss cap.',
  },
  {
    q: 'How do auto-tune and backtesting help?',
    a: 'The backtester replays any strategy against historical data so you can see net return, win rate, drawdown and profit factor before risking anything. Auto-tune searches nearby parameter sets and suggests the one with the best profit factor.',
  },
  {
    q: 'Do I need a package to trade?',
    a: 'No — free paper trading is always available with 1 robot. Packages unlock live/managed trading, more robot slots and MT4/5 account connections. See the Packages page for details.',
  },
  {
    q: 'How do I connect a real broker?',
    a: 'On the Brokers page you can connect OANDA or an MT4/5 account. Live trading is proxied through secure server-side bridges, so your broker credentials never leave our servers.',
  },
  {
    q: 'How do payouts work?',
    a: 'Commissions from referrals accumulate as withdrawable balance. On the Gateway page you request a payout by bank, e-wallet or USDT — an admin reviews it and pays out within a few business days.',
  },
]

export function Help() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Help centre"
        description="Quick answers to the most common questions."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-accent" aria-hidden="true" />
            Frequently asked questions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {FAQS.map((f, i) => {
              const isOpen = open === i
              return (
                <div key={f.q} className="overflow-hidden rounded-lg border border-border/60">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 bg-secondary/30 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/40"
                  >
                    {f.q}
                    <ChevronDown
                      className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </button>
                  {isOpen && (
                    <p className="border-t border-border/60 bg-background/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                      {f.a}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Still stuck?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            For anything not covered here, reach out and we'll help you out.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/contact">
              <Button variant="secondary" size="sm">Contact support</Button>
            </Link>
            <Link to="/backtester">
              <Button variant="ghost" size="sm">Try the backtester</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}