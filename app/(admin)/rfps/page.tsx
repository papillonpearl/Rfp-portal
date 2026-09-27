import Link from 'next/link'
import { requireStaff } from '@/lib/authz'
import { listRfps } from '@/lib/rfps/store'
import { LocalTime } from '@/components/local-time'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function RfpsPage() {
  const staff = await requireStaff()
  const rows = await listRfps()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">RFPs</h1>
        {staff.role === 'admin' && <Link href="/rfps/new" className={buttonVariants()}>New RFP</Link>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Lines (shared)</TableHead>
            <TableHead>Bids</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No RFPs yet.</TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                <Link href={`/rfps/${r.id}`} className="hover:underline">{r.title}</Link>
              </TableCell>
              <TableCell>{r.type}</TableCell>
              <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
              <TableCell><LocalTime iso={r.dueAt?.toISOString() ?? null} fallback="Not set" /></TableCell>
              <TableCell className="text-right tabular-nums">{r.lineCount} ({r.sharedLineCount})</TableCell>
              <TableCell>{r.sealed ? 'Sealed' : 'Open view'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
