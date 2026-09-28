import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { inviteCandidates, sendBlockers } from '@/lib/invites/store'
import { getRfp } from '@/lib/rfps/store'
import { buttonVariants } from '@/components/ui/button'
import { InvitePicker } from './invite-picker'

export default async function InvitePage(props: PageProps<'/rfps/[id]/invite'>) {
  const staff = await requireStaff()
  const { id } = await props.params
  if (staff.role !== 'admin') redirect(`/rfps/${id}`)
  const rfp = await getRfp(id)
  if (!rfp) notFound()
  const [candidates, blockers] = await Promise.all([inviteCandidates(id), sendBlockers(id)])

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Invite suppliers to {rfp.title}</h1>
        <Link href={`/rfps/${id}/preview`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>What they will see</Link>
      </div>
      {rfp.status === 'draft' && (
        <p className="rounded-md border border-warning bg-warning/15 p-3 text-sm">
          Sending opens this RFP. From then on its lines, documents and shared details are frozen; later changes go out as
          addenda. Check the supplier preview first.
        </p>
      )}
      {blockers.length > 0 ? (
        <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-8 text-sm">
          {blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      ) : (
        <InvitePicker rfpId={id} candidates={candidates} />
      )}
    </div>
  )
}
