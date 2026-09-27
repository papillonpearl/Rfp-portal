'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { importAction, type ImportState } from '../actions'
import type { CsvPlan } from '@/lib/suppliers/csv'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, { stage: 'idle' })

  if (state.stage === 'done') {
    const r = state.result
    return (
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <p>
          Imported {r.created} supplier{r.created === 1 ? '' : 's'} with {r.contacts} contact
          {r.contacts === 1 ? '' : 's'}.{r.skipped > 0 && ` Skipped ${r.skipped} already in the directory.`}
        </p>
        <div className="flex gap-2">
          <Link href="/suppliers" className={buttonVariants()}>View suppliers</Link>
          {/* A full reload, so the form and its state start clean. */}
          <Button variant="outline" onClick={() => window.location.reload()}>Import another file</Button>
        </div>
      </div>
    )
  }

  const plan = state.stage === 'preview' || state.stage === 'error' ? state.plan : undefined
  const text = state.stage === 'preview' || state.stage === 'error' ? state.text : undefined
  const fileName = state.stage === 'preview' || state.stage === 'error' ? state.fileName : undefined

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="intent" value="preview" />
        <Input type="file" name="file" accept=".csv,text/csv" required className="max-w-sm" />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Reading…' : 'Preview'}
        </Button>
      </form>

      {state.stage === 'error' && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {state.message}
        </p>
      )}

      {plan && <PlanView plan={plan} fileName={fileName} />}

      {plan && text !== undefined && (
        <form action={action}>
          <input type="hidden" name="intent" value="commit" />
          <input type="hidden" name="text" value={text} />
          <input type="hidden" name="fileName" value={fileName ?? ''} />
          <Button type="submit" disabled={pending || !plan.ok || plan.counts.create === 0}>
            {pending
              ? 'Importing…'
              : plan.ok
                ? `Import ${plan.counts.create} supplier${plan.counts.create === 1 ? '' : 's'}`
                : 'Fix the problems above to import'}
          </Button>
        </form>
      )}
    </div>
  )
}

function PlanView({ plan, fileName }: { plan: CsvPlan; fileName?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-medium">{fileName}</span>: {plan.counts.create} to add ({plan.counts.contacts} contacts),{' '}
        {plan.counts.skip} already in the directory, {plan.counts.invalid} with problems.
      </p>

      {plan.fileErrors.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-8 text-sm">
          {plan.fileErrors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {plan.rowErrors.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-8 text-sm">
          {plan.rowErrors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
        </ul>
      )}
      {plan.ignoredColumns.length > 0 && (
        <p className="text-sm text-muted-foreground">Ignored columns: {plan.ignoredColumns.join(', ')}</p>
      )}

      {plan.suppliers.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lines</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Contacts</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.suppliers.map((s) => (
              <TableRow key={s.lines.join(',')} className={s.action === 'invalid' ? 'bg-destructive/5' : undefined}>
                <TableCell className="tabular-nums text-muted-foreground">{s.lines.join(', ')}</TableCell>
                <TableCell className="font-medium">{s.company}</TableCell>
                <TableCell>{s.input?.category ?? '—'}</TableCell>
                <TableCell>
                  {s.input?.contacts.map((c) => (
                    <div key={c.email} className="text-xs">
                      {c.name} &lt;{c.email}&gt;{c.isPrimary && ' · primary'}
                    </div>
                  ))}
                </TableCell>
                <TableCell>
                  <Badge variant={s.action === 'create' ? 'secondary' : s.action === 'invalid' ? 'destructive' : 'outline'}>
                    {s.action === 'create' ? 'Add' : s.action === 'invalid' ? 'Problem' : 'Skip'}
                  </Badge>
                  {[...s.errors, ...s.notes].map((m) => (
                    <div key={m} className="mt-1 text-xs text-muted-foreground">{m}</div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
