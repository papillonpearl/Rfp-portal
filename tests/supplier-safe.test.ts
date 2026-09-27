import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { eq, getTableColumns } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { attachments, lineItems, rfps, users } from '@/lib/db/schema'
import { addLines, createRfp, recordAttachment, setLineVisibility } from '@/lib/rfps/store'
import { getSupplierSafeRfp, sharedAttachmentForDownload } from '@/lib/rfps/supplier-safe'
import { lineInput } from '@/lib/rfps/validation'
import { resetDb } from './db'

// Every internal value carries this marker. If it appears anywhere in what
// getSupplierSafeRfp returns — any key, any depth — something leaked.
const SECRET = 'INTERNAL-SENTINEL'

let rfpId: string

beforeEach(async () => {
  await resetDb()
  const [u] = await db.insert(users).values({ email: 'a@team.example', role: 'admin' }).returning()
  rfpId = await createRfp(
    {
      title: 'Battery replacement 2027',
      type: 'RFQ',
      description: 'Shared introduction',
      internalNotes: `${SECRET} budget is 1.2M`,
      dueAt: new Date('2026-12-01T17:00:00Z'),
      sealed: true,
    },
    u.id,
  )
  const line = (equipment: string, visibility: 'internal' | 'shared', estimate: string) =>
    lineInput.parse({ site: 'Site A', equipment, spec: '', qty: '4', unit: 'ea', visibility, internalEstimate: estimate })
  await addLines(rfpId, [
    line('Shared UPS module', 'shared', '999999.99'),
    line(`${SECRET} internal-only line`, 'internal', '1'),
  ])
  const sharedFile = await recordAttachment({ rfpId, name: 'spec-sheet.pdf', storageKey: `rfps/${rfpId}/shared-key`, contentType: 'application/pdf', size: 10, uploadedBy: u.id })
  await recordAttachment({ rfpId, name: `${SECRET}-budget.xlsx`, storageKey: `rfps/${rfpId}/${SECRET}`, contentType: 'application/vnd.ms-excel', size: 10, uploadedBy: u.id })
  await db.update(attachments).set({ visibility: 'shared' }).where(eq(attachments.id, sharedFile))
})
afterAll(() => pool.end())

describe('getSupplierSafeRfp', () => {
  it('returns shared lines and attachments and nothing internal, anywhere', async () => {
    const safe = await getSupplierSafeRfp(rfpId)
    expect(safe).not.toBeNull()
    expect(safe!.lines.map((l) => l.equipment)).toEqual(['Shared UPS module'])
    expect(safe!.attachments.map((a) => a.name)).toEqual(['spec-sheet.pdf'])
    expect(JSON.stringify(safe)).not.toContain(SECRET)
    // The estimate on the SHARED line must not travel with it either.
    expect(JSON.stringify(safe)).not.toContain('999999')
  })

  it('returns exactly the allowed keys, so a new column is internal until added here on purpose', async () => {
    const safe = (await getSupplierSafeRfp(rfpId))!
    expect(Object.keys(safe).sort()).toEqual(
      ['attachments', 'currentRound', 'description', 'dueAt', 'id', 'lines', 'title', 'type'].sort(),
    )
    expect(Object.keys(safe.lines[0]).sort()).toEqual(['equipment', 'id', 'position', 'qty', 'site', 'spec', 'unit'].sort())
    expect(Object.keys(safe.attachments[0]).sort()).toEqual(['contentType', 'id', 'name', 'size'].sort())
  })

  it('knows every column in the tables it reads, and which are allowed out', () => {
    // A column added to rfps, line_items or attachments fails this test
    // until someone decides whether suppliers may see it.
    const decided = {
      rfps: {
        shared: ['id', 'title', 'type', 'description', 'dueAt', 'currentRound'],
        internal: ['status', 'internalNotes', 'sealed', 'createdBy', 'createdAt', 'updatedAt'],
      },
      lineItems: {
        shared: ['id', 'position', 'site', 'equipment', 'spec', 'qty', 'unit'],
        internal: ['rfpId', 'visibility', 'internalEstimate', 'createdAt'],
      },
      attachments: {
        shared: ['id', 'name', 'contentType', 'size'],
        internal: ['rfpId', 'storageKey', 'visibility', 'uploadedBy', 'createdAt'],
      },
    }
    const tables = { rfps, lineItems, attachments }
    for (const [name, t] of Object.entries(tables)) {
      const d = decided[name as keyof typeof decided]
      expect(Object.keys(getTableColumns(t)).sort(), name).toEqual([...d.shared, ...d.internal].sort())
    }
  })

  it('makes a line visible the moment it is shared, and hides it again', async () => {
    const all = await db.select().from(lineItems)
    const internal = all.find((l) => l.visibility === 'internal')!
    await setLineVisibility(rfpId, [internal.id], 'shared')
    expect((await getSupplierSafeRfp(rfpId))!.lines).toHaveLength(2)
    await setLineVisibility(rfpId, [internal.id], 'internal')
    expect((await getSupplierSafeRfp(rfpId))!.lines).toHaveLength(1)
  })

  it('returns null for an unknown or malformed id', async () => {
    expect(await getSupplierSafeRfp('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(await getSupplierSafeRfp('nope')).toBeNull()
  })
})

describe('sharedAttachmentForDownload', () => {
  it('serves a shared file and refuses an internal one', async () => {
    const files = await db.select().from(attachments)
    const shared = files.find((f) => f.visibility === 'shared')!
    const internal = files.find((f) => f.visibility === 'internal')!
    expect(await sharedAttachmentForDownload(rfpId, shared.id)).toMatchObject({ name: 'spec-sheet.pdf' })
    expect(await sharedAttachmentForDownload(rfpId, internal.id)).toBeNull()
  })

  it("refuses a shared file named under a different RFP's id", async () => {
    const other = await createRfp({ title: 'Other', type: 'RFP', description: '', internalNotes: '', dueAt: null, sealed: false }, (await db.select().from(users))[0].id)
    const shared = (await db.select().from(attachments)).find((f) => f.visibility === 'shared')!
    expect(await sharedAttachmentForDownload(other, shared.id)).toBeNull()
  })
})

describe('structure', () => {
  // From Phase 3, supplier-facing code lives under app/portal and
  // app/api/portal. It may read RFPs only through supplier-safe.ts, never
  // the database or the admin store directly. Checked now so the rule is in
  // place before the first portal file is written.
  it('supplier-facing code cannot import the database or the admin store', () => {
    const roots = ['app/portal', 'app/api/portal'].map((r) => path.resolve(__dirname, '..', r))
    const offenders: string[] = []
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8')
          if (/from ['"]@\/lib\/(db|rfps\/store)(['"/])/.test(src)) offenders.push(path.relative(process.cwd(), p))
        }
      }
    }
    roots.forEach(walk)
    expect(offenders).toEqual([])
  })
})
