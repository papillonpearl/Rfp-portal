'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { saveSupplier } from '@/app/(admin)/suppliers/actions'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input, Label, NativeSelect } from '@/components/ui/input'

type ContactDraft = { key: string; id: string | null; name: string; email: string; isPrimary: boolean }

export type SupplierFormValues = {
  id?: string
  company: string
  category: string
  region: string
  status: 'active' | 'inactive'
  contacts: { id: string; name: string; email: string; isPrimary: boolean }[]
}

let nextKey = 0
const newKey = () => `c${nextKey++}`

export function SupplierForm({
  initial,
  categories,
}: {
  initial?: SupplierFormValues
  categories: string[]
}) {
  const [state, action, pending] = useActionState(saveSupplier, undefined)
  const [company, setCompany] = useState(initial?.company ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [region, setRegion] = useState(initial?.region ?? '')
  const [status, setStatus] = useState<'active' | 'inactive'>(initial?.status ?? 'active')
  const [contacts, setContacts] = useState<ContactDraft[]>(
    initial?.contacts.map((c) => ({ ...c, key: newKey() })) ?? [
      { key: newKey(), id: null, name: '', email: '', isPrimary: true },
    ],
  )

  const update = (key: string, patch: Partial<ContactDraft>) =>
    setContacts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  const makePrimary = (key: string) =>
    setContacts((cs) => cs.map((c) => ({ ...c, isPrimary: c.key === key })))
  const remove = (key: string) =>
    setContacts((cs) => {
      const rest = cs.filter((c) => c.key !== key)
      // Removing the primary hands it to the first remaining contact rather
      // than leaving a supplier nobody can be invited through.
      if (rest.length && !rest.some((c) => c.isPrimary)) rest[0] = { ...rest[0], isPrimary: true }
      return rest
    })

  // The server validates everything again; this only packages the form.
  const payload = JSON.stringify({
    id: initial?.id,
    supplier: {
      company,
      category,
      region,
      status,
      contacts: contacts.map(({ name, email, isPrimary }) => ({ name, email, isPrimary })),
    },
    contactIds: contacts.map((c) => c.id),
  })

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />

      {state?.errors && state.errors.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <ul className="list-disc pl-5">
            {state.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="company">Company</Label>
          <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="category">Category</Label>
          <Input
            id="category"
            list="category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="UPS, batteries, chillers…"
            required
          />
          <datalist id="category-options">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="region">Region</Label>
          <Input id="region" value={region} onChange={(e) => setRegion(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Contacts</legend>
        <p className="text-sm text-muted-foreground">
          The primary contact receives RFP invitations.
        </p>
        {contacts.map((c, i) => (
          <div key={c.key} className="grid items-end gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`name-${c.key}`} className="text-xs">Name</Label>
              <Input id={`name-${c.key}`} value={c.name} onChange={(e) => update(c.key, { name: e.target.value })} required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`email-${c.key}`} className="text-xs">Email</Label>
              <Input id={`email-${c.key}`} type="email" value={c.email} onChange={(e) => update(c.key, { email: e.target.value })} required />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="radio" name="primary" checked={c.isPrimary} onChange={() => makePrimary(c.key)} />
              Primary
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(c.key)}
              disabled={contacts.length === 1}
              aria-label={`Remove contact ${i + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setContacts((cs) => [...cs, { key: newKey(), id: null, name: '', email: '', isPrimary: cs.length === 0 }])
            }
          >
            Add contact
          </Button>
        </div>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save supplier'}</Button>
        <Link href="/suppliers" className={buttonVariants({ variant: 'ghost' })}>Cancel</Link>
      </div>
    </form>
  )
}
