'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef } from 'react'
import { saveLine } from '@/app/(admin)/rfps/actions'
import { submitKeepingInput } from '@/lib/forms'
import { Button } from '@/components/ui/button'
import { Input, Label, NativeSelect } from '@/components/ui/input'

export type LineFormValues = {
  id: string
  site: string | null
  equipment: string
  spec: string
  qty: string
  unit: string
  visibility: 'internal' | 'shared'
  internalEstimate: string | null
}

export function LineForm({ rfpId, initial }: { rfpId: string; initial?: LineFormValues }) {
  const [state, action, pending] = useActionState(saveLine, undefined)
  const form = useRef<HTMLFormElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!state || state.errors.length > 0) return
    if (initial) router.replace(`/rfps/${rfpId}#lines`)
    else form.current?.reset()
  }, [state, initial, rfpId, router])

  const f = (id: string) => `${initial?.id ?? 'new'}-${id}`
  return (
    <form ref={form} onSubmit={submitKeepingInput(action)} className="flex flex-col gap-3">
      <input type="hidden" name="rfpId" value={rfpId} />
      {initial && <input type="hidden" name="lineId" value={initial.id} />}
      {state && state.errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-8 text-sm">
          {state.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={f('equipment')} className="text-xs">Equipment</Label>
          <Input id={f('equipment')} name="equipment" defaultValue={initial?.equipment} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={f('site')} className="text-xs">Site <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={f('site')} name="site" defaultValue={initial?.site ?? ''} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={f('qty')} className="text-xs">Qty</Label>
          <Input id={f('qty')} name="qty" inputMode="decimal" defaultValue={initial?.qty} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={f('unit')} className="text-xs">Unit</Label>
          <Input id={f('unit')} name="unit" defaultValue={initial?.unit ?? 'ea'} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={f('visibility')} className="text-xs">Visibility</Label>
          <NativeSelect id={f('visibility')} name="visibility" defaultValue={initial?.visibility ?? 'internal'}>
            <option value="internal">Internal</option>
            <option value="shared">Shared</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-4">
          <Label htmlFor={f('spec')} className="text-xs">Spec</Label>
          <Input id={f('spec')} name="spec" defaultValue={initial?.spec} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={f('internalEstimate')} className="text-xs">Internal estimate, unit price <span className="font-normal text-muted-foreground">(team only)</span></Label>
          <Input id={f('internalEstimate')} name="internalEstimate" inputMode="decimal" defaultValue={initial?.internalEstimate ?? ''} placeholder="$" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save line' : 'Add line'}</Button>
        {initial && (
          <Button type="button" size="sm" variant="ghost" onClick={() => router.replace(`/rfps/${rfpId}#lines`)}>Cancel</Button>
        )}
      </div>
    </form>
  )
}
