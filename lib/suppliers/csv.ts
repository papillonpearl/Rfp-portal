import Papa from 'papaparse'
import { companyKey, issuesOf, supplierInput, type SupplierInput } from './validation'

// CSV bulk import: one row per CONTACT, grouped into suppliers by company.
//
//   company,category,region,status,contact_name,contact_email,is_primary
//
// Parsing is pure and runs twice — once for the preview, and again on the
// server when the import is committed — so what gets written is never taken
// on trust from what the browser was shown.

export const MAX_CSV_BYTES = 1_000_000
export const MAX_CSV_ROWS = 2_000

export const CSV_COLUMNS = [
  'company',
  'category',
  'region',
  'status',
  'contact_name',
  'contact_email',
  'is_primary',
] as const
const REQUIRED_COLUMNS = ['company', 'category', 'contact_name', 'contact_email'] as const

type Column = (typeof CSV_COLUMNS)[number]

export type RowError = { line: number; message: string }

export type PlannedSupplier = {
  company: string
  /** Spreadsheet line numbers (header is line 1) this supplier came from. */
  lines: number[]
  action: 'create' | 'skip-exists' | 'invalid'
  errors: string[]
  notes: string[]
  input?: SupplierInput
}

export type CsvPlan = {
  /** Problems with the file itself: size, headers, unparseable rows. */
  fileErrors: string[]
  rowErrors: RowError[]
  suppliers: PlannedSupplier[]
  ignoredColumns: string[]
  /** True only when nothing is wrong anywhere. An import is all-or-nothing. */
  ok: boolean
  counts: { create: number; skip: number; invalid: number; contacts: number }
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

const TRUE_VALUES = new Set(['yes', 'y', 'true', '1', 'x', 'primary'])
const FALSE_VALUES = new Set(['no', 'n', 'false', '0', ''])

function parseFlag(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase()
  if (TRUE_VALUES.has(v)) return true
  if (FALSE_VALUES.has(v)) return false
  return undefined
}

/**
 * @param existing company keys already in the directory (see `companyKey`).
 *   A company that exists is skipped, never updated: an import that silently
 *   overwrote a supplier's category or contacts would be an edit nobody made.
 */
export function planCsvImport(text: string, existing: Set<string>): CsvPlan {
  const plan: CsvPlan = {
    fileErrors: [],
    rowErrors: [],
    suppliers: [],
    ignoredColumns: [],
    ok: false,
    counts: { create: 0, skip: 0, invalid: 0, contacts: 0 },
  }

  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) {
    plan.fileErrors.push(`File is larger than ${MAX_CSV_BYTES / 1_000_000} MB`)
    return plan
  }

  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    skipEmptyLines: 'greedy',
  })
  const [header, ...rows] = parsed.data
  if (!header) {
    plan.fileErrors.push('The file is empty')
    return plan
  }
  for (const e of parsed.errors) {
    // Papa's row index counts data rows from 0 after the header was included,
    // so +1 for 1-based lines.
    plan.rowErrors.push({ line: (e.row ?? 0) + 1, message: e.message })
  }

  const index = new Map<Column, number>()
  header.forEach((h, i) => {
    const name = normalizeHeader(h)
    if ((CSV_COLUMNS as readonly string[]).includes(name)) {
      if (index.has(name as Column)) plan.fileErrors.push(`Column "${name}" appears twice`)
      index.set(name as Column, i)
    } else if (name !== '') {
      plan.ignoredColumns.push(h.trim())
    }
  })
  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c))
  if (missing.length > 0) {
    plan.fileErrors.push(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    )
  }
  if (rows.length === 0) plan.fileErrors.push('The file has a header but no rows')
  if (rows.length > MAX_CSV_ROWS) {
    plan.fileErrors.push(`Too many rows (${rows.length}); the limit is ${MAX_CSV_ROWS}`)
  }
  if (plan.fileErrors.length > 0) return plan

  const cell = (row: string[], col: Column) => {
    const i = index.get(col)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }

  type Group = {
    company: string
    lines: number[]
    category: Set<string>
    categoryRaw: string
    region: Set<string>
    regionRaw: string
    status: Set<string>
    contacts: { name: string; email: string; isPrimary: boolean | undefined; line: number }[]
    errors: string[]
  }
  const groups = new Map<string, Group>()

  rows.forEach((row, i) => {
    const line = i + 2 // header is line 1
    const company = cell(row, 'company')
    if (company === '') {
      plan.rowErrors.push({ line, message: 'Company is blank' })
      return
    }
    const key = companyKey(company)
    let g = groups.get(key)
    if (!g) {
      g = {
        company: company.replace(/\s+/g, ' '),
        lines: [],
        category: new Set(),
        categoryRaw: '',
        region: new Set(),
        regionRaw: '',
        status: new Set(),
        contacts: [],
        errors: [],
      }
      groups.set(key, g)
    }
    g.lines.push(line)

    const category = cell(row, 'category')
    if (category) {
      g.category.add(category.toLowerCase())
      g.categoryRaw ||= category
    }
    const region = cell(row, 'region')
    if (region) {
      g.region.add(region.toLowerCase())
      g.regionRaw ||= region
    }
    const status = cell(row, 'status').toLowerCase()
    if (status) g.status.add(status)

    const primaryRaw = cell(row, 'is_primary')
    const isPrimary = parseFlag(primaryRaw)
    if (isPrimary === undefined) {
      g.errors.push(`Line ${line}: is_primary "${primaryRaw}" is not yes or no`)
    }
    g.contacts.push({
      name: cell(row, 'contact_name'),
      email: cell(row, 'contact_email'),
      isPrimary,
      line,
    })
  })

  for (const [key, g] of groups) {
    const planned: PlannedSupplier = {
      company: g.company,
      lines: g.lines,
      action: 'create',
      errors: [...g.errors],
      notes: [],
    }
    // Rows for one company must agree. Picking the first value would be a
    // guess, and the preview exists so nobody has to find out later.
    if (g.category.size > 1) planned.errors.push('Rows disagree on category')
    if (g.region.size > 1) planned.errors.push('Rows disagree on region')
    if (g.status.size > 1) planned.errors.push('Rows disagree on status')
    const status = [...g.status][0] ?? 'active'
    if (status !== 'active' && status !== 'inactive') {
      planned.errors.push(`Status "${status}" must be active or inactive`)
    }

    // A single contact with nothing marked is unambiguous; several are not.
    const marked = g.contacts.some((c) => c.isPrimary)
    const contacts = g.contacts.map((c) => ({
      name: c.name,
      email: c.email,
      isPrimary: c.isPrimary === true || (!marked && g.contacts.length === 1),
    }))
    if (!marked && g.contacts.length === 1) {
      planned.notes.push('Only contact, so marked primary')
    }

    const result = supplierInput.safeParse({
      company: g.company,
      category: g.categoryRaw,
      region: g.regionRaw,
      status,
      contacts,
    })
    if (!result.success) planned.errors.push(...issuesOf(result.error))
    else planned.input = result.data

    if (planned.errors.length > 0) {
      planned.action = 'invalid'
      delete planned.input
    } else if (existing.has(key)) {
      planned.action = 'skip-exists'
      planned.notes.push('Already in the directory — skipped, not updated')
    }
    plan.suppliers.push(planned)
  }

  for (const s of plan.suppliers) {
    if (s.action === 'create') {
      plan.counts.create++
      plan.counts.contacts += s.input!.contacts.length
    } else if (s.action === 'skip-exists') plan.counts.skip++
    else plan.counts.invalid++
  }
  plan.ok =
    plan.fileErrors.length === 0 && plan.rowErrors.length === 0 && plan.counts.invalid === 0
  return plan
}
