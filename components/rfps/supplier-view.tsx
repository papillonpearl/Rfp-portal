import { FileText } from 'lucide-react'
import type { SupplierSafeRfp } from '@/lib/rfps/supplier-safe'
import { formatBytes, formatQty } from '@/lib/format'
import { LocalTime } from '@/components/local-time'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// Renders an RFP from getSupplierSafeRfp() and nothing else. Its only input
// is the supplier-safe type, so it cannot show what that function withheld.
// The admin preview uses it now; the supplier portal will in Phase 3.

export function SupplierView({ rfp, fileHref }: { rfp: SupplierSafeRfp; fileHref: (id: string) => string }) {
  const hasSites = rfp.lines.some((l) => l.site)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{rfp.type}</p>
        <h1 className="text-2xl font-semibold">{rfp.title}</h1>
        <p className="text-sm">Responses due <strong><LocalTime iso={rfp.dueAt?.toISOString() ?? null} fallback="— not set" /></strong></p>
      </div>
      {rfp.description && <div className="whitespace-pre-wrap text-sm">{rfp.description}</div>}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Line items</h2>
        {rfp.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                {hasSites && <TableHead>Site</TableHead>}
                <TableHead>Equipment</TableHead>
                <TableHead>Spec</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfp.lines.map((l, i) => (
                <TableRow key={l.id}>
                  {/* Numbered by what the supplier sees, so gaps left by
                      internal lines don't hint that anything is missing. */}
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  {hasSites && <TableCell>{l.site ?? '—'}</TableCell>}
                  <TableCell className="font-medium">{l.equipment}</TableCell>
                  <TableCell className="whitespace-pre-wrap">{l.spec}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(l.qty)}</TableCell>
                  <TableCell>{l.unit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {rfp.attachments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Documents</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {rfp.attachments.map((a) => (
              <li key={a.id}>
                <a href={fileHref(a.id)} className="inline-flex items-center gap-2 hover:underline">
                  <FileText className="size-4" /> {a.name} <span className="text-muted-foreground">{formatBytes(a.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
