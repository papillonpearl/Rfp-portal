import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { RfpForm } from '@/components/rfps/rfp-form'

export default async function NewRfpPage() {
  const staff = await requireStaff()
  if (staff.role !== 'admin') redirect('/rfps')
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New RFP</h1>
      <RfpForm />
    </div>
  )
}
