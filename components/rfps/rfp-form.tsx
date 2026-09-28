'use client'

import Link from 'next/link'
import { useActionState, useState, useSyncExternalStore } from 'react'
import { saveRfp } from '@/app/(admin)/rfps/actions'
import { submitKeepingInput } from '@/lib/forms'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input, Label, NativeSelect } from '@/components/ui/input'

export type RfpFormValues = {
  id: string
  title: string
  type: 'RFP' | 'RFQ'
  description: string
  internalNotes: string
  dueAt: string | null
  sealed: boolean
}

const noop = () => () => {}

/** ISO instant → value for <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function RfpForm({ initial, locked = false }: { initial?: RfpFormValues; locked?: boolean }) {
  const [state, action, pending] = useActionState(saveRfp, undefined)
  // Local time exists only in the browser, so the due field renders after
  // hydration; until the admin edits it, the stored instant is sent unchanged.
  const inBrowser = useSyncExternalStore(noop, () => true, () => false)
  const [due, setDue] = useState<string | null>(null)
  const dueIso = due === null ? (initial?.dueAt ?? '') : due ? new Date(due).toISOString() : ''
  const zone = inBrowser ? Intl.DateTimeFormat().resolvedOptions().timeZone : ''

  if (locked && initial) {
    // Invites are out: only the internal notes can change. Everything else
    // is sent back exactly as stored, which the server checks.
    return (
      <form onSubmit={submitKeepingInput(action)} className="flex max-w-3xl flex-col gap-4">
        <input type="hidden" name="rfpId" value={initial.id} />
        <input type="hidden" name="title" value={initial.title} />
        <input type="hidden" name="type" value={initial.type} />
        <input type="hidden" name="description" value={initial.description} />
        <input type="hidden" name="dueAt" value={initial.dueAt ?? ''} />
        {initial.sealed && <input type="hidden" name="sealed" value="on" />}
        <p className="rounded-md border bg-muted p-3 text-sm">
          Invites have gone out, so the title, type, due date, sealing and description are frozen. Only the internal notes
          can change here.
        </p>
        {state?.errors && state.errors.length > 0 && (
          <p role="alert" className="text-sm text-destructive">{state.errors[0]}</p>
        )}
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
          <Label htmlFor="internalNotes">Internal notes <span className="font-normal text-muted-foreground">— team only, never shown to a supplier</span></Label>
          <textarea id="internalNotes" name="internalNotes" defaultValue={initial.internalNotes} rows={6}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save notes'}</Button>
          <Link href={`/rfps/${initial.id}`} className={buttonVariants({ variant: 'ghost' })}>Cancel</Link>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submitKeepingInput(action)} className="flex max-w-3xl flex-col gap-5">
      {initial && <input type="hidden" name="rfpId" value={initial.id} />}
      <input type="hidden" name="dueAt" value={dueIso} />
      {state?.errors && state.errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-8 text-sm">
          {state.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={initial?.title} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="type">Type</Label>
          <NativeSelect id="type" name="type" defaultValue={initial?.type ?? 'RFQ'}>
            <option value="RFQ">RFQ</option>
            <option value="RFP">RFP</option>
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="due">Due</Label>
        {inBrowser ? (
          <Input id="due" type="datetime-local" defaultValue={toLocalInput(initial?.dueAt ?? null)}
            onChange={(e) => setDue(e.target.value)} className="max-w-xs" />
        ) : (
          <Input id="due" disabled className="max-w-xs" />
        )}
        <p className="text-xs text-muted-foreground">In your time zone ({zone}). Suppliers see it in theirs.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="sealed" defaultChecked={initial?.sealed ?? true} className="mt-0.5" />
        <span>
          <span className="font-medium">Sealed bids</span>
          <span className="block text-muted-foreground">
            Bid amounts stay hidden from the team until the due date, showing only who has submitted. (Takes effect
            when bidding opens in a later phase.)
          </span>
        </span>
      </label>
      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description <span className="font-normal text-muted-foreground">— shared with invited suppliers</span></Label>
        <textarea id="description" name="description" defaultValue={initial?.description} rows={6}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
        <Label htmlFor="internalNotes">Internal notes <span className="font-normal text-muted-foreground">— team only, never shown to a supplier</span></Label>
        <textarea id="internalNotes" name="internalNotes" defaultValue={initial?.internalNotes} rows={4}
          placeholder="Budget, strategy, anything suppliers must not see"
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save details' : 'Create RFP'}</Button>
        <Link href={initial ? `/rfps/${initial.id}` : '/rfps'} className={buttonVariants({ variant: 'ghost' })}>Cancel</Link>
      </div>
    </form>
  )
}
