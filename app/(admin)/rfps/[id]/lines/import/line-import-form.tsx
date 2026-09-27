'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { importLines, type LineImportState } from '../../../actions'
import { formatMoney, formatQty } from '@/lib/format'
import { VisibilityBadge } from '@/components/rfps/visibility'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function LineImportForm({ rfpId, maxBytes }: { rfpId: string; maxBytes: number }) {
  const [state, action, pending] = useActionState<LineImportState, FormData>(importLines, { stage: 'idle' })
  const [tooBig, setTooBig] = useState<string | null>(null)

  if (state.stage === 'done') {
    return (
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <p>Added {state.added} line{state.added === 1 ? '' : 's'}, all as uploaded. Check visibility before inviting suppliers.</p>
        <div><Link href={`/rfps/${rfpId}#lines`} className={buttonVariants()}>Back to the RFP</Link></div>
      </div>
    )
  }
  const plan = state.stage === 'preview' ? state.plan : undefined

  return (
    <div className="flex flex-col gap-4">
      <form
        action={action}
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0]
          if (file && file.size > maxBytes) {
            e.preventDefault()
            setTooBig(`${file.name} is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${maxBytes / 1e6} MB.`)
          } else setTooBig(null)
        }}
      >
        <input type="hidden" name="rfpId" value={rfpId} />
        <input type="hidden" name="intent" value="preview" />
        <Input type="file" name="file" accept=".xlsx,.csv" required className="max-w-sm" />
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? 'Reading…' : 'Preview'}</Button>
      </form>

      {(tooBig || state.stage === 'error') && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {tooBig ?? (state.stage === 'error' ? state.message : '')}
        </p>
      )}

      {plan && state.stage === 'preview' && (
        <>
          <p className="text-sm">
            <span className="font-medium">{state.fileName}</span>: {plan.lines.length} good line{plan.lines.length === 1 ? '' : 's'},{' '}
            {plan.rowErrors.length} row{plan.rowErrors.length === 1 ? '' : 's'} with problems.
          </p>
          {plan.fileErrors.length > 0 && (
            <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-8 text-sm">
              {plan.fileErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {plan.rowErrors.length > 0 && (
            <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-8 text-sm">
              {plan.rowErrors.map((e) => <li key={e.line}>Row {e.line}: {e.messages.join('; ')}</li>)}
            </ul>
          )}
          {[...plan.notes, ...(plan.ignoredColumns.length ? [`Ignored columns: ${plan.ignoredColumns.join(', ')}`] : [])].map((n) => (
            <p key={n} className="text-sm text-muted-foreground">{n}</p>
          ))}
          {plan.lines.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                  <TableHead>Visibility</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.lines.map((l) => (
                  <TableRow key={l.line}>
                    <TableCell className="tabular-nums text-muted-foreground">{l.line}</TableCell>
                    <TableCell>{l.site ?? '—'}</TableCell>
                    <TableCell className="font-medium">{l.equipment}</TableCell>
                    <TableCell className="max-w-64 truncate">{l.spec}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.qty)}</TableCell>
                    <TableCell>{l.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(l.internalEstimate)}</TableCell>
                    <TableCell><VisibilityBadge value={l.visibility} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <form action={action}>
            <input type="hidden" name="rfpId" value={rfpId} />
            <input type="hidden" name="intent" value="commit" />
            <input type="hidden" name="lines" value={JSON.stringify(plan.lines)} />
            <Button type="submit" disabled={pending || !plan.ok}>
              {pending ? 'Adding…' : plan.ok ? `Add ${plan.lines.length} line${plan.lines.length === 1 ? '' : 's'}` : 'Fix the problems above to add lines'}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}
