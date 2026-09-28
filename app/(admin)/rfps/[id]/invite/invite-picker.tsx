'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import type { Candidate } from '@/lib/invites/store'
import { submitKeepingInput } from '@/lib/forms'
import { sendInvitesAction, type SendState } from '../../actions'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function InvitePicker({ rfpId, candidates }: { rfpId: string; candidates: Candidate[] }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendInvitesAction, undefined)
  const selectable = useMemo(() => candidates.filter((c) => !c.invited && c.primaryEmail), [candidates])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const categories = useMemo(() => [...new Set(selectable.map((c) => c.category))].sort(), [selectable])

  if (state?.result) {
    const r = state.result
    return (
      <div className="flex flex-col gap-3 rounded-md border p-4 text-sm">
        <p>
          Invited {r.invited} supplier{r.invited === 1 ? '' : 's'}; {r.emailed} email{r.emailed === 1 ? '' : 's'} sent.
          {r.alreadyInvited > 0 && ` ${r.alreadyInvited} were already invited and were not emailed again.`}
        </p>
        {r.failed.length > 0 && (
          <p className="text-destructive">
            Could not email {r.failed.join(', ')}. Their invites exist; use Resend on the RFP page once email is working.
          </p>
        )}
        {r.noContact.length > 0 && <p className="text-destructive">No contact to email for {r.noContact.join(', ')}; not invited.</p>}
        <div><Link href={`/rfps/${rfpId}#invites`} className={buttonVariants()}>Back to the RFP</Link></div>
      </div>
    )
  }

  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const allOn = selectable.length > 0 && selectable.every((c) => picked.has(c.supplierId))

  return (
    <form onSubmit={submitKeepingInput(action)} className="flex flex-col gap-3">
      <input type="hidden" name="rfpId" value={rfpId} />
      {[...picked].map((id) => <input key={id} type="hidden" name="supplierId" value={id} />)}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="button" size="sm" variant="outline" onClick={() => setPicked(allOn ? new Set() : new Set(selectable.map((c) => c.supplierId)))}>
          {allOn ? 'Clear all' : 'Select all'}
        </Button>
        <span className="text-muted-foreground">or by category:</span>
        {categories.map((cat) => (
          <Button key={cat} type="button" size="sm" variant="outline"
            onClick={() => setPicked(new Set(selectable.filter((c) => c.category === cat).map((c) => c.supplierId)))}>
            {cat}
          </Button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"><span className="sr-only">Select</span></TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Primary contact</TableHead>
            <TableHead className="text-right">Contacts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow key={c.supplierId} className={c.invited ? 'text-muted-foreground' : undefined}>
              <TableCell>
                {c.invited ? (
                  <Badge variant="secondary">Invited</Badge>
                ) : (
                  <input type="checkbox" aria-label={`Invite ${c.company}`} disabled={!c.primaryEmail}
                    checked={picked.has(c.supplierId)} onChange={(e) => toggle(c.supplierId, e.target.checked)} />
                )}
              </TableCell>
              <TableCell className="font-medium">{c.company}</TableCell>
              <TableCell>{c.category}</TableCell>
              <TableCell>{c.region ?? '—'}</TableCell>
              <TableCell>{c.primaryEmail ?? <span className="text-destructive">None</span>}</TableCell>
              <TableCell className="text-right tabular-nums">{c.contactCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="allContacts" />
        Email every contact at each supplier, not only the primary (each gets their own link)
      </label>
      {state?.errors && state.errors.length > 0 && <p role="alert" className="text-sm text-destructive">{state.errors[0]}</p>}
      <div>
        <Button type="submit" disabled={pending || picked.size === 0}>
          {pending ? 'Sending…' : `Send to ${picked.size} supplier${picked.size === 1 ? '' : 's'}`}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Each contact gets a separate email with their own private link. No supplier can see who else was invited.
      </p>
    </form>
  )
}
