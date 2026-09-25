import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { CSV_COLUMNS, MAX_CSV_ROWS } from '@/lib/suppliers/csv'
import { ImportForm } from './import-form'

export default async function ImportPage() {
  const staff = await requireStaff()
  if (staff.role !== 'admin') redirect('/suppliers')
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Import suppliers from CSV</h1>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          One row per contact. Rows with the same company become one supplier with several contacts.
          Columns: <code className="text-foreground">{CSV_COLUMNS.join(', ')}</code>. Region, status and
          is_primary are optional. <a className="underline underline-offset-4" href="/supplier-import-template.csv" download>Download the template</a>.
        </p>
        <p>
          You will see a preview first. Nothing is written until you confirm, and the import is all or nothing:
          if any row has a problem, no supplier is added. Companies already in the directory are skipped, never
          changed. Up to {MAX_CSV_ROWS.toLocaleString()} rows.
        </p>
      </div>
      <ImportForm />
    </div>
  )
}
