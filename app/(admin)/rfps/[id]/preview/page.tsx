import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { getSupplierSafeRfp } from '@/lib/rfps/supplier-safe'
import { SupplierView } from '@/components/rfps/supplier-view'
import { buttonVariants } from '@/components/ui/button'

// Built from getSupplierSafeRfp(), the same function the supplier portal will
// use, so this is what a supplier receives rather than a mock-up of it.
export default async function SupplierPreviewPage(props: PageProps<'/rfps/[id]/preview'>) {
  await requireStaff()
  const { id } = await props.params
  const rfp = await getSupplierSafeRfp(id)
  if (!rfp) notFound()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed bg-muted/50 p-3 text-sm">
        <span className="mr-auto">
          <strong>Supplier preview.</strong> Exactly what an invited supplier receives: shared lines and documents only,
          no estimates or internal notes.
        </span>
        <Link href={`/rfps/${id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Back to builder</Link>
      </div>
      <div className="rounded-lg border p-6">
        <SupplierView rfp={rfp} fileHref={(a) => `/api/rfps/${id}/attachments/${a}`} />
      </div>
    </div>
  )
}
