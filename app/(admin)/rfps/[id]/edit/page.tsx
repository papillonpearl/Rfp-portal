import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { getRfp } from '@/lib/rfps/store'
import { RfpForm } from '@/components/rfps/rfp-form'

export default async function EditRfpPage(props: PageProps<'/rfps/[id]/edit'>) {
  const staff = await requireStaff()
  const { id } = await props.params
  if (staff.role !== 'admin') redirect(`/rfps/${id}`)
  const rfp = await getRfp(id)
  if (!rfp) notFound()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit details</h1>
      <RfpForm
        initial={{
          id: rfp.id,
          title: rfp.title,
          type: rfp.type,
          description: rfp.description,
          internalNotes: rfp.internalNotes,
          dueAt: rfp.dueAt?.toISOString() ?? null,
          sealed: rfp.sealed,
        }}
      />
    </div>
  )
}
