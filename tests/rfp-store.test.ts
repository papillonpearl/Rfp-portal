import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db'
import { users } from '@/lib/db/schema'
import {
  addLines,
  createRfp,
  deleteAttachment,
  deleteLine,
  getRfp,
  recordAttachment,
  setAttachmentVisibility,
  setLineVisibility,
  updateLine,
} from '@/lib/rfps/store'
import { lineInput } from '@/lib/rfps/validation'
import { resetDb } from './db'

let a: string
let b: string
let uid: string
const line = (equipment: string) => lineInput.parse({ equipment, qty: '1', unit: 'ea', site: '', spec: '', internalEstimate: '' })
const blank = { type: 'RFP' as const, description: '', internalNotes: '', dueAt: null, sealed: true }

beforeEach(async () => {
  await resetDb()
  uid = (await db.insert(users).values({ email: 'a@team.example', role: 'admin' }).returning())[0].id
  a = await createRfp({ ...blank, title: 'A' }, uid)
  b = await createRfp({ ...blank, title: 'B' }, uid)
})
afterAll(() => pool.end())

describe('RFP store', () => {
  it('appends uploaded lines after existing ones, in order', async () => {
    await addLines(a, [line('one'), line('two')])
    await addLines(a, [line('three')])
    expect((await getRfp(a))!.lines.map((l) => [l.position, l.equipment])).toEqual([
      [1, 'one'],
      [2, 'two'],
      [3, 'three'],
    ])
  })

  it('new lines and attachments are internal unless someone shares them', async () => {
    await addLines(a, [line('x')])
    await recordAttachment({ rfpId: a, name: 'f.pdf', storageKey: 'k1', contentType: 'application/pdf', size: 1, uploadedBy: uid })
    const rfp = (await getRfp(a))!
    expect(rfp.lines[0].visibility).toBe('internal')
    expect(rfp.attachments[0].visibility).toBe('internal')
  })

  it("never touches another RFP's line or attachment through a forged id", async () => {
    await addLines(b, [line('B line')])
    const fid = await recordAttachment({ rfpId: b, name: 'b.pdf', storageKey: 'kb', contentType: 'application/pdf', size: 1, uploadedBy: uid })
    const bLine = (await getRfp(b))!.lines[0]

    expect(await updateLine(a, bLine.id, line('hijacked'))).toBe(false)
    expect(await setLineVisibility(a, [bLine.id], 'shared')).toBe(0)
    expect(await deleteLine(a, bLine.id)).toBe(false)
    expect(await setAttachmentVisibility(a, fid, 'shared')).toBe(false)
    expect(await deleteAttachment(a, fid)).toBeUndefined()

    const after = (await getRfp(b))!
    expect(after.lines[0]).toMatchObject({ equipment: 'B line', visibility: 'internal' })
    expect(after.attachments).toHaveLength(1)
  })

  it('stores quantities and estimates exactly', async () => {
    await addLines(a, [lineInput.parse({ equipment: 'x', qty: '0.125', unit: 'ea', internalEstimate: '1,234,567.89' })])
    expect((await getRfp(a))!.lines[0]).toMatchObject({ qty: '0.125', internalEstimate: '1234567.89' })
  })
})
