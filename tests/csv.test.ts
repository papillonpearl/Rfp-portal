import { describe, expect, it } from 'vitest'
import { MAX_CSV_ROWS, planCsvImport } from '@/lib/suppliers/csv'

const HEADER = 'company,category,region,status,contact_name,contact_email,is_primary'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n')
const none = new Set<string>()

describe('planCsvImport', () => {
  it('groups rows by company into one supplier with several contacts', () => {
    const plan = planCsvImport(
      csv(
        'Acme Power,UPS,West,active,Ana One,ana@acme.example,yes',
        'Acme Power,UPS,West,active,Ben Two,BEN@acme.example,no',
        'Cool Co,Chillers,,,Cy Three,cy@cool.example,',
      ),
      none,
    )
    expect(plan.ok).toBe(true)
    expect(plan.counts).toEqual({ create: 2, skip: 0, invalid: 0, contacts: 3 })
    const acme = plan.suppliers.find((s) => s.company === 'Acme Power')!
    expect(acme.lines).toEqual([2, 3])
    expect(acme.input!.contacts.map((c) => c.email)).toEqual(['ana@acme.example', 'ben@acme.example'])
  })

  it('treats company names case- and space-insensitively when grouping', () => {
    const plan = planCsvImport(
      csv('Acme Power,UPS,,,A,a@x.example,yes', ' acme  power ,UPS,,,B,b@x.example,no'),
      none,
    )
    expect(plan.suppliers).toHaveLength(1)
  })

  it('makes a lone contact primary, and says so', () => {
    const plan = planCsvImport(csv('Solo,UPS,,,Only One,one@solo.example,'), none)
    expect(plan.ok).toBe(true)
    expect(plan.suppliers[0].input!.contacts[0].isPrimary).toBe(true)
    expect(plan.suppliers[0].notes).toContain('Only contact, so marked primary')
  })

  it('refuses several contacts with no primary rather than guessing one', () => {
    const plan = planCsvImport(csv('Duo,UPS,,,A,a@duo.example,no', 'Duo,UPS,,,B,b@duo.example,no'), none)
    expect(plan.ok).toBe(false)
    expect(plan.suppliers[0].action).toBe('invalid')
    expect(plan.suppliers[0].errors).toContain('Mark one contact as primary')
  })

  it('refuses two primaries', () => {
    const plan = planCsvImport(csv('Duo,UPS,,,A,a@duo.example,yes', 'Duo,UPS,,,B,b@duo.example,yes'), none)
    expect(plan.suppliers[0].errors).toContain('Only one contact can be primary')
  })

  it('refuses rows for one company that disagree', () => {
    const plan = planCsvImport(
      csv('Mix,UPS,West,,A,a@mix.example,yes', 'Mix,Chillers,East,,B,b@mix.example,no'),
      none,
    )
    expect(plan.suppliers[0].errors).toEqual(
      expect.arrayContaining(['Rows disagree on category', 'Rows disagree on region']),
    )
  })

  it('refuses a bad email, a bad flag and a bad status, naming each', () => {
    const plan = planCsvImport(
      csv('Bad,UPS,,retired,A,not-an-email,maybe'),
      none,
    )
    const errors = plan.suppliers[0].errors.join(' | ')
    expect(errors).toMatch(/not a valid address/)
    expect(errors).toMatch(/Line 2: is_primary "maybe"/)
    expect(errors).toMatch(/Status "retired"/)
  })

  it('reports a blank company by line', () => {
    const plan = planCsvImport(csv(',UPS,,,A,a@x.example,yes'), none)
    expect(plan.ok).toBe(false)
    expect(plan.rowErrors).toEqual([{ line: 2, message: 'Company is blank' }])
  })

  it('skips a company already in the directory and never plans to update it', () => {
    const plan = planCsvImport(csv('Acme Power,UPS,,,A,a@x.example,yes'), new Set(['acme power']))
    expect(plan.ok).toBe(true)
    expect(plan.suppliers[0].action).toBe('skip-exists')
    expect(plan.counts).toMatchObject({ create: 0, skip: 1 })
  })

  it('names missing required columns and stops', () => {
    const plan = planCsvImport('company,category\nAcme,UPS', none)
    expect(plan.ok).toBe(false)
    expect(plan.fileErrors[0]).toMatch(/Missing required columns: contact_name, contact_email/)
  })

  it('accepts friendly headers, a byte-order mark, and reports unknown columns', () => {
    const plan = planCsvImport(
      '﻿Company,Category,Contact Name,Contact-Email,Notes\nAcme,UPS,A,a@x.example,hello',
      none,
    )
    expect(plan.ok).toBe(true)
    expect(plan.ignoredColumns).toEqual(['Notes'])
  })

  it('refuses a file over the row limit', () => {
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `Co ${i},UPS,,,A,a${i}@x.example,yes`)
    const plan = planCsvImport(csv(...rows), none)
    expect(plan.ok).toBe(false)
    expect(plan.fileErrors[0]).toMatch(/Too many rows/)
  })

  it('is not ok when any single supplier has a problem, so the import is all or nothing', () => {
    const plan = planCsvImport(
      csv('Good,UPS,,,A,a@good.example,yes', 'Bad,UPS,,,B,nope,yes'),
      none,
    )
    expect(plan.counts).toMatchObject({ create: 1, invalid: 1 })
    expect(plan.ok).toBe(false)
  })
})
