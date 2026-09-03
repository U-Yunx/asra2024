/**
 * AddOnsSection — the add-on catalog on the Packages page. Renders each active
 * add-on with its price and a buy button; shows how many slots the user already
 * owns from their active purchases.
 */
import { PackagePlus } from 'lucide-react'
import type { AddonPurchaseRow, AddonRow } from '../lib/types'
import { formatUsd } from '../lib/format'
import { cn } from '../lib/cn'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from './ui'

const KIND_LABEL: Record<AddonRow['kind'], string> = {
  robot: 'Robot slot',
  mt_account: 'MT account slot',
  ads: 'Ad slot',
}

export function AddOnsSection({
  addons,
  purchases,
  onPurchase,
  disabled,
}: {
  addons: AddonRow[]
  purchases: AddonPurchaseRow[]
  onPurchase: (addon: AddonRow) => void
  disabled?: boolean
}) {
  const active = addons.filter((a) => a.active)

  if (active.length === 0) return null

  const owned = (kind: AddonRow['kind']): number =>
    purchases
      .filter((p) => p.status === 'active' && p.addons?.kind === kind)
      .reduce((sum, p) => sum + (p.addons?.amount ?? 0), 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackagePlus className="h-4 w-4 text-accent" aria-hidden="true" />
          Add-ons
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          Extend your package — extra robot, MT account and ad slots.
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((a) => {
            const mine = owned(a.kind)
            return (
              <div
                key={a.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-secondary/30 p-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{a.name}</p>
                    <Badge className="border-accent/40 bg-accent/10 text-accent">{KIND_LABEL[a.kind]}</Badge>
                  </div>
                  {a.description && <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>}
                  <p className="mt-2 text-sm">
                    <span className="font-mono text-lg font-bold text-foreground">{formatUsd(a.price)}</span>
                    <span className="ml-1 text-xs text-muted-foreground">/ {a.duration_days}d</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    +{a.amount} {KIND_LABEL[a.kind].toLowerCase()}(s)
                    {mine > 0 && <span className="text-up"> · {mine} owned</span>}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onPurchase(a)}
                  className={cn('w-full')}
                >
                  Buy add-on
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
