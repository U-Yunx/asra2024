/**
 * Contact — public contact page showing the platform's admin contact details
 * (email, WhatsApp, phone) loaded from the `contact_settings` row.
 */
import { Mail, MessageCircle, Phone } from 'lucide-react'
import { useContactSettings } from '../hooks/usePlatform'
import { Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton } from '../components/ui'

export function Contact() {
  const { contact, loading } = useContactSettings()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Contact us"
        description="Questions about the platform, packages or payouts? Reach out any time."
      />

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : !contact ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Contact details haven't been published yet — check back soon.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Channel
            icon={<Mail className="h-5 w-5 text-accent" aria-hidden="true" />}
            label="Email"
            value={contact.email}
            href={`mailto:${contact.email}`}
          />
          <Channel
            icon={<MessageCircle className="h-5 w-5 text-accent" aria-hidden="true" />}
            label="WhatsApp"
            value={contact.whatsapp}
            href={`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, '')}`}
          />
          <Channel
            icon={<Phone className="h-5 w-5 text-accent" aria-hidden="true" />}
            label="Phone"
            value={contact.phone}
            href={`tel:${contact.phone}`}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Before you write</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Having trouble with the trading robot? Check the <a className="text-accent hover:underline" href="/help">Help page</a> first.
            </li>
            <li>
              Need a payout or subscription reviewed? Expect 1–3 business days for manual processing.
            </li>
            <li>
              Include your account email so we can find you faster.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function Channel({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode
  label: string
  value: string
  href: string
}) {
  return (
    <a
      href={href}
      className="rounded-xl border border-border bg-secondary/30 p-5 transition-colors hover:border-accent/50"
    >
      <div className="mb-3">{icon}</div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium text-foreground">{value}</p>
    </a>
  )
}