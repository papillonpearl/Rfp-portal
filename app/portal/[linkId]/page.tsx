import type { Metadata } from 'next'
import { logActivity } from '@/lib/activity'
import { ownBids, ownSubmission } from '@/lib/portal/bids'
import { requirePortalAccess } from '@/lib/portal/session'
import { getSupplierSafeRfp } from '@/lib/rfps/supplier-safe'
import { LocalTime } from '@/components/local-time'
import { SupplierView } from '@/components/rfps/supplier-view'
import { NotValid } from '../enter/enter-portal'
import { BidForm } from './bid-form'

export const metadata: Metadata = { title: 'Your response', referrer: 'no-referrer', robots: { index: false } }

export default async function PortalPage(props: PageProps<'/portal/[linkId]'>) {
  const { linkId } = await props.params
  const access = await requirePortalAccess(linkId)
  // Revoked, expired, unknown, or a cookie for some other link: all the same
  // page, and none of it shows a byte of the RFP.
  if (!access) {
    return (
      <main className="flex flex-1 items-center justify-center p-4">
        <NotValid />
      </main>
    )
  }
  const [rfp, bids, submittedAt] = await Promise.all([
    getSupplierSafeRfp(access.rfpId),
    ownBids(access),
    ownSubmission(access),
  ])
  if (!rfp) return <NotValid />
  await logActivity({
    actor: { type: 'supplier', id: access.linkId },
    rfpId: access.rfpId,
    action: 'portal.viewed',
    detail: { inviteId: access.inviteId },
  })

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <span className="font-semibold">Supplier response</span>
          <span className="ml-auto text-muted-foreground">{access.company} · {access.email}</span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6">
        <SupplierView rfp={rfp} fileHref={(id) => `/portal/${linkId}/files/${id}`} />
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Your response</h2>
          {submittedAt ? (
            <p className="rounded-md border bg-muted p-3 text-sm">
              Submitted <LocalTime iso={submittedAt.toISOString()} />. Your response for this round is final; if the
              request is revised you will be asked for an update.
            </p>
          ) : !access.canBid ? (
            <p className="rounded-md border bg-muted p-3 text-sm">Responses closed <LocalTime iso={access.dueAt.toISOString()} />.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Due <strong><LocalTime iso={access.dueAt.toISOString()} /></strong>. Save a draft as often as you like; only
              you can see it. Submitting is final for this round. Leave a price blank to not bid on that line.
            </p>
          )}
          <BidForm
            linkId={linkId}
            lines={rfp.lines}
            bids={bids.map((b) => ({ ...b, submittedAt: b.submittedAt?.toISOString() ?? null }))}
            readOnly={Boolean(submittedAt) || !access.canBid}
          />
        </section>
      </main>
    </>
  )
}
