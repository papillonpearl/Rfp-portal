import 'server-only'
import { and, asc, eq, ilike, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { supplierContacts, suppliers } from '@/lib/db/schema'
import { companyKey, type SupplierInput } from './validation'
import type { CsvPlan } from './csv'

export type SupplierFilters = {
  q?: string
  category?: string
  region?: string
  status?: 'active' | 'inactive'
}

export type SupplierRow = {
  id: string
  company: string
  category: string
  region: string | null
  status: 'active' | 'inactive'
  primaryName: string | null
  primaryEmail: string | null
  contactCount: number
}

// Correlated subqueries name the outer table explicitly. Interpolating
// `suppliers.id` renders as a bare "id" in a select list, which inside the
// subquery resolves to the CONTACT's id — every supplier then shows no
// primary contact and zero contacts, silently. A test pins it.
const OUTER_ID = sql.raw('"suppliers"."id"')

/** Escape LIKE wildcards so a search for "50%" means the characters. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export async function listSuppliers(f: SupplierFilters = {}): Promise<SupplierRow[]> {
  const where: SQL[] = []
  const q = f.q?.trim()
  if (q) {
    const term = likeTerm(q)
    // A search matches the company, or any of its contacts by name or email.
    where.push(
      or(
        ilike(suppliers.company, term),
        sql`exists (select 1 from ${supplierContacts} c where c.supplier_id = ${OUTER_ID} and (c.name ilike ${term} or c.email ilike ${term}))`,
      )!,
    )
  }
  if (f.category) where.push(sql`lower(${suppliers.category}) = lower(${f.category})`)
  if (f.region) where.push(sql`lower(${suppliers.region}) = lower(${f.region})`)
  if (f.status) where.push(eq(suppliers.status, f.status))

  const rows = await db
    .select({
      id: suppliers.id,
      company: suppliers.company,
      category: suppliers.category,
      region: suppliers.region,
      status: suppliers.status,
      primaryName: sql<string | null>`(select c.name from ${supplierContacts} c where c.supplier_id = ${OUTER_ID} and c.is_primary)`,
      primaryEmail: sql<string | null>`(select c.email from ${supplierContacts} c where c.supplier_id = ${OUTER_ID} and c.is_primary)`,
      contactCount: sql<number>`(select count(*)::int from ${supplierContacts} c where c.supplier_id = ${OUTER_ID})`,
    })
    .from(suppliers)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(sql`lower(${suppliers.company})`))
  return rows
}

/** Distinct categories and regions actually in use, for the filter dropdowns. */
export async function supplierFacets(): Promise<{ categories: string[]; regions: string[] }> {
  const cats = await db
    .selectDistinct({ v: suppliers.category })
    .from(suppliers)
    .orderBy(asc(suppliers.category))
  const regs = await db
    .selectDistinct({ v: suppliers.region })
    .from(suppliers)
    .orderBy(asc(suppliers.region))
  return {
    categories: dedupeCaseless(cats.map((r) => r.v)),
    regions: dedupeCaseless(regs.map((r) => r.v).filter((v): v is string => Boolean(v))),
  }
}

function dedupeCaseless(values: string[]): string[] {
  const seen = new Map<string, string>()
  for (const v of values) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
  return [...seen.values()]
}

export async function getSupplier(id: string) {
  // A malformed id is "not found", not a database error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!supplier) return undefined
  const contacts = await db
    .select()
    .from(supplierContacts)
    .where(eq(supplierContacts.supplierId, id))
    .orderBy(sql`${supplierContacts.isPrimary} desc`, asc(supplierContacts.name))
  return { ...supplier, contacts }
}

export async function existingCompanyKeys(): Promise<Set<string>> {
  const rows = await db.select({ company: suppliers.company }).from(suppliers)
  return new Set(rows.map((r) => companyKey(r.company)))
}

export class DuplicateCompany extends Error {
  constructor(company: string) {
    super(`A supplier named "${company}" already exists`)
  }
}

function isUniqueViolation(e: unknown, constraint: string): boolean {
  // drizzle wraps driver errors; the pg error is on `cause`.
  const err = (e as { cause?: unknown })?.cause ?? e
  const pg = err as { code?: string; constraint?: string }
  return pg?.code === '23505' && pg.constraint === constraint
}

export async function createSupplier(input: SupplierInput): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(suppliers)
        .values({
          company: input.company,
          category: input.category,
          region: input.region,
          status: input.status,
        })
        .returning({ id: suppliers.id })
      await tx.insert(supplierContacts).values(
        input.contacts.map((c) => ({ supplierId: row.id, ...c })),
      )
      return row.id
    })
  } catch (e) {
    if (isUniqueViolation(e, 'suppliers_company_key')) throw new DuplicateCompany(input.company)
    throw e
  }
}

export type ContactEdit = SupplierInput['contacts'][number] & { id?: string }

/**
 * Contacts are updated in place by id, not deleted and re-created: later
 * phases hang invites and the activity log off a contact, and replacing the
 * rows would orphan all of it on every edit.
 */
export async function updateSupplier(
  id: string,
  input: Omit<SupplierInput, 'contacts'> & { contacts: ContactEdit[] },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(suppliers)
        .set({
          company: input.company,
          category: input.category,
          region: input.region,
          status: input.status,
          updatedAt: new Date(),
        })
        .where(eq(suppliers.id, id))
        .returning({ id: suppliers.id })
      if (updated.length === 0) throw new Error('Supplier not found')

      const keepIds = input.contacts.map((c) => c.id).filter((v): v is string => Boolean(v))
      await tx
        .delete(supplierContacts)
        .where(
          keepIds.length
            ? and(eq(supplierContacts.supplierId, id), notInArray(supplierContacts.id, keepIds))
            : eq(supplierContacts.supplierId, id),
        )
      // Clear the primary flag first: the one-primary index is checked per
      // statement, so moving it from one contact to another in two updates
      // would otherwise collide in the middle.
      await tx
        .update(supplierContacts)
        .set({ isPrimary: false })
        .where(eq(supplierContacts.supplierId, id))

      const kept = keepIds.length
        ? await tx
            .select({ id: supplierContacts.id })
            .from(supplierContacts)
            .where(and(eq(supplierContacts.supplierId, id), inArray(supplierContacts.id, keepIds)))
        : []
      const owned = new Set(kept.map((k) => k.id))

      // Move the primary last, after every other row is settled.
      const ordered = [...input.contacts].sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary))
      for (const c of ordered) {
        const values = { name: c.name, email: c.email, isPrimary: c.isPrimary }
        // An id that does not belong to this supplier is treated as new,
        // never as a licence to edit another supplier's contact.
        if (c.id && owned.has(c.id)) {
          await tx.update(supplierContacts).set(values).where(eq(supplierContacts.id, c.id))
        } else {
          await tx.insert(supplierContacts).values({ supplierId: id, ...values })
        }
      }
    })
  } catch (e) {
    if (isUniqueViolation(e, 'suppliers_company_key')) throw new DuplicateCompany(input.company)
    throw e
  }
}

export class ConcurrentImport extends Error {
  constructor() {
    super('A supplier in this file was added by someone else meanwhile, so nothing was imported. Preview again.')
  }
}

export type ImportResult = { created: number; contacts: number; skipped: number }

/** All-or-nothing: a plan with any problem writes nothing. */
export async function importSuppliers(plan: CsvPlan): Promise<ImportResult> {
  if (!plan.ok) throw new Error('The import has problems; nothing was written')
  const toCreate = plan.suppliers.filter((s) => s.action === 'create')
  try {
    await db.transaction(async (tx) => {
      for (const s of toCreate) {
        const input = s.input!
        const [row] = await tx
          .insert(suppliers)
          .values({
            company: input.company,
            category: input.category,
            region: input.region,
            status: input.status,
          })
          .returning({ id: suppliers.id })
        await tx
          .insert(supplierContacts)
          .values(input.contacts.map((c) => ({ supplierId: row.id, ...c })))
      }
    })
  } catch (e) {
    // Someone added one of these companies between preview and commit.
    if (isUniqueViolation(e, 'suppliers_company_key')) {
      throw new ConcurrentImport()
    }
    throw e
  }
  return {
    created: toCreate.length,
    contacts: toCreate.reduce((n, s) => n + s.input!.contacts.length, 0),
    skipped: plan.counts.skip,
  }
}

// No delete. A supplier is retired by setting status to inactive: from Phase 3
// on, invites, bids and the activity log point at suppliers, and deleting one
// would take its bid history with it.
