import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { LINE_COLUMNS, MAX_LINE_FILE_BYTES, MAX_LINE_ROWS } from '@/lib/rfps/line-sheet'
import { getRfp } from '@/lib/rfps/store'
import { LineImportForm } from './line-import-form'

export default async function LineImportPage(props: PageProps<'/rfps/[id]/lines/import'>) {
  const staff = await requireStaff()
  const { id } = await props.params
  if (staff.role !== 'admin') redirect(`/rfps/${id}`)
  const rfp = await getRfp(id)
  if (!rfp) notFound()
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Upload lines to {rfp.title}</h1>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          An .xlsx or .csv file; the first sheet is read, and the first row is the header. Columns:{' '}
          <code className="text-foreground">{LINE_COLUMNS.join(', ')}</code>. Equipment, qty and unit are required.{' '}
          <a className="underline underline-offset-4" href="/line-items-template.csv" download>Download the template</a>.
        </p>
        <p>
          Lines are added after the {rfp.lines.length} already here. Visibility defaults to internal. You see a preview
          first, and if any row has a problem no lines are added. Up to {MAX_LINE_ROWS.toLocaleString()} rows and{' '}
          {MAX_LINE_FILE_BYTES / 1e6} MB.
        </p>
      </div>
      <LineImportForm rfpId={rfp.id} maxBytes={MAX_LINE_FILE_BYTES} />
    </div>
  )
}
