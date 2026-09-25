import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { supplierContacts } from '@/lib/db/schema'
import { planCsvImport } from '@/lib/suppliers/csv'
import {
  ConcurrentImport,
  createSupplier,
  DuplicateCompany,
  existingCompanyKeys,
  getSupplier,
  importSuppliers,
  listSuppliers,
  supplierFacets,
  updateSupplier,
} from '@/lib/suppliers/store'
import { supplierInput, type SupplierInput } from '@/lib/suppliers/validation'
import { resetDb } from './db'

const make = (over: Partial<SupplierInput> = {}): SupplierInput =>
  supplierInput.parse({
    company: 'Acme Power',
    category: 'UPS',
    region: 'West',
    status: 'active',
    contacts: [
      { name: 'Ana', email: 'ana@acme.example', isPrimary: true },
      { name: 'Ben', email: 'ben@acme.example', isPrimary: false },
    ],
    ...over,
  })

beforeEach(resetDb)
afterAll(() => pool.end())

describe('suppliers store', () => {
  it('creates a supplier with its contacts', async () => {
    const id = await createSupplier(make())
    const s = await getSupplier(id)
    expect(s?.contacts.map((c) => [c.email, c.isPrimary])).toEqual([
      ['ana@acme.example', true],
      ['ben@acme.example', false],
    ])
  })

  it('refuses a second supplier whose name differs only in case and spacing', async () => {
    await createSupplier(make())
    await expect(createSupplier(make({ company: 'ACME   POWER' }))).rejects.toBeInstanceOf(DuplicateCompany)
  })

  it('the database itself refuses two primary contacts', async () => {
    const id = await createSupplier(make())
    await expect(
      db.update(supplierContacts).set({ isPrimary: true }).where(eq(supplierContacts.supplierId, id)),
    ).rejects.toThrow()
  })

  it('edits contacts in place, keeping their ids, and can move the primary', async () => {
    const id = await createSupplier(make())
    const before = (await getSupplier(id))!
    const ana = before.contacts.find((c) => c.name === 'Ana')!
    const ben = before.contacts.find((c) => c.name === 'Ben')!

    await updateSupplier(id, {
      ...make(),
      contacts: [
        { id: ana.id, name: 'Ana', email: 'ana@acme.example', isPrimary: false },
        { id: ben.id, name: 'Ben B.', email: 'ben@acme.example', isPrimary: true },
        { name: 'Cy', email: 'cy@acme.example', isPrimary: false },
      ],
    })
    const after = (await getSupplier(id))!
    expect(after.contacts.find((c) => c.id === ben.id)).toMatchObject({ name: 'Ben B.', isPrimary: true })
    expect(after.contacts.find((c) => c.id === ana.id)).toMatchObject({ isPrimary: false })
    expect(after.contacts).toHaveLength(3)
  })

  it('removes contacts left out of an edit', async () => {
    const id = await createSupplier(make())
    const ana = (await getSupplier(id))!.contacts.find((c) => c.name === 'Ana')!
    await updateSupplier(id, {
      ...make(),
      contacts: [{ id: ana.id, name: 'Ana', email: 'ana@acme.example', isPrimary: true }],
    })
    expect((await getSupplier(id))!.contacts.map((c) => c.id)).toEqual([ana.id])
  })

  it("never edits another supplier's contact through a forged id", async () => {
    const a = await createSupplier(make())
    const b = await createSupplier(
      make({ company: 'Other Co', contacts: [{ name: 'Zed', email: 'zed@other.example', isPrimary: true }] }),
    )
    const zed = (await getSupplier(b))!.contacts[0]

    await updateSupplier(a, {
      ...make(),
      contacts: [{ id: zed.id, name: 'Hijacked', email: 'h@acme.example', isPrimary: true }],
    })
    expect((await getSupplier(b))!.contacts[0]).toMatchObject({ id: zed.id, name: 'Zed' })
    expect((await getSupplier(a))!.contacts.map((c) => c.name)).toEqual(['Hijacked'])
  })

  it('returns nothing for a malformed id rather than a database error', async () => {
    expect(await getSupplier('not-a-uuid')).toBeUndefined()
  })

  it('searches company and contact names and emails, and filters case-insensitively', async () => {
    await createSupplier(make())
    await createSupplier(
      make({ company: 'Cool Co', category: 'Chillers', region: 'East', contacts: [{ name: 'Dee', email: 'dee@cool.example', isPrimary: true }] }),
    )
    expect((await listSuppliers({ q: 'acme' })).map((s) => s.company)).toEqual(['Acme Power'])
    expect((await listSuppliers({ q: 'dee@' })).map((s) => s.company)).toEqual(['Cool Co'])
    expect((await listSuppliers({ category: 'chillers' })).map((s) => s.company)).toEqual(['Cool Co'])
    expect((await listSuppliers({ region: 'WEST' })).map((s) => s.company)).toEqual(['Acme Power'])
    const [row] = await listSuppliers({ q: 'acme' })
    expect(row).toMatchObject({ primaryEmail: 'ana@acme.example', contactCount: 2 })
  })

  it('treats LIKE wildcards in a search as literal characters', async () => {
    await createSupplier(make())
    expect(await listSuppliers({ q: '%' })).toHaveLength(0)
    expect(await listSuppliers({ q: '_' })).toHaveLength(0)
  })

  it('lists each category once regardless of case', async () => {
    await createSupplier(make())
    await createSupplier(make({ company: 'B', category: 'ups', contacts: [{ name: 'X', email: 'x@b.example', isPrimary: true }] }))
    expect((await supplierFacets()).categories).toHaveLength(1)
  })
})

describe('CSV import', () => {
  const HEADER = 'company,category,region,status,contact_name,contact_email,is_primary'

  it('writes every new supplier and skips existing ones untouched', async () => {
    const id = await createSupplier(make())
    const plan = planCsvImport(
      [HEADER, 'acme power,Chillers,,,Q,q@acme.example,yes', 'New Co,UPS,,,N,n@new.example,yes'].join('\n'),
      await existingCompanyKeys(),
    )
    const result = await importSuppliers(plan)
    expect(result).toEqual({ created: 1, contacts: 1, skipped: 1 })
    expect((await getSupplier(id))!.category).toBe('UPS') // not overwritten
    expect(await listSuppliers()).toHaveLength(2)
  })

  it('writes nothing when the plan has any problem', async () => {
    const plan = planCsvImport([HEADER, 'Good,UPS,,,A,a@g.example,yes', 'Bad,UPS,,,B,nope,yes'].join('\n'), new Set())
    await expect(importSuppliers(plan)).rejects.toThrow()
    expect(await listSuppliers()).toHaveLength(0)
  })

  it('rolls back the whole file if a company appears between preview and commit', async () => {
    const plan = planCsvImport(
      [HEADER, 'First Co,UPS,,,A,a@f.example,yes', 'Late Co,UPS,,,B,b@l.example,yes'].join('\n'),
      new Set(),
    )
    await createSupplier(make({ company: 'Late Co', contacts: [{ name: 'L', email: 'l@l.example', isPrimary: true }] }))
    await expect(importSuppliers(plan)).rejects.toBeInstanceOf(ConcurrentImport)
    expect((await listSuppliers()).map((s) => s.company)).toEqual(['Late Co'])
  })
})
