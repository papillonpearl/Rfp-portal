import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture outgoing mail instead of sending it; the tokens live only there.
const sent = vi.hoisted(() => ({ mails: [] as { to: string; text: string }[] }))
vi.mock('@/lib/email', () => ({
  sendMailBatch: async (mails: { to: string; text: string }[]) => {
    sent.mails.push(...mails)
    return mails.map(() => ({ ok: true, mode: 'logged' }))
  },
  sendMail: async () => {},
}))

import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { activityLog, bids, invites, inviteLinks, lineItems, rfps, users } from '@/lib/db/schema'
import { inviteTracker, reissueLink, revokeInvite, sendBlockers, sendInvites } from '@/lib/invites/store'
import { enterPortal, portalAccess, type PortalAccess } from '@/lib/portal/access'
import { BidRefused, ownBids, ownSubmission, saveBids } from '@/lib/portal/bids'
import { addLines, createRfp, recordAttachment, RfpLocked, updateRfp } from '@/lib/rfps/store'
import { getSupplierSafeRfp, sharedAttachmentForDownload } from '@/lib/rfps/supplier-safe'
import { lineInput } from '@/lib/rfps/validation'
import { createSupplier } from '@/lib/suppliers/store'
import { supplierInput } from '@/lib/suppliers/validation'
import { resetDb } from './db'

const SECRET = 'INTERNAL-SENTINEL'
const DAY = 86_400_000

let staff: string
let rfpId: string
let otherRfpId: string
let sharedLine: string
let internalLine: string
let otherRfpLine: string
let A: string, B: string, C: string

const supplier = (company: string, emails: string[]) =>
  createSupplier(
    supplierInput.parse({
      company,
      category: 'UPS',
      region: '',
      status: 'active',
      contacts: emails.map((email, i) => ({ name: email.split('@')[0], email, isPrimary: i === 0 })),
    }),
  )

const tokenFor = (email: string) => {
  const mail = [...sent.mails].reverse().find((m) => m.to === email)
  return mail?.text.match(/\/portal\/enter#([A-Za-z0-9_-]{43})/)?.[1]
}

async function enter(email: string): Promise<{ access: PortalAccess; token: string }> {
  const token = tokenFor(email)!
  const access = (await enterPortal(token))!
  expect(access, `enter as ${email}`).not.toBeNull()
  return { access, token }
}

beforeEach(async () => {
  await resetDb()
  sent.mails = []
  staff = (await db.insert(users).values({ email: 'admin@team.example', role: 'admin' }).returning())[0].id
  A = await supplier('Alpha Power', ['a1@alpha.example', 'a2@alpha.example'])
  B = await supplier('Beta Cells', ['b1@beta.example'])
  C = await supplier('Gamma Cooling', ['c1@gamma.example'])

  const base = { type: 'RFQ' as const, description: 'Shared intro', sealed: true }
  rfpId = await createRfp({ ...base, title: 'Batteries', internalNotes: `${SECRET} budget`, dueAt: new Date(Date.now() + 7 * DAY) }, staff)
  otherRfpId = await createRfp({ ...base, title: 'Other', internalNotes: '', dueAt: new Date(Date.now() + 7 * DAY) }, staff)
  const l = (equipment: string, visibility: 'shared' | 'internal', estimate: string) =>
    lineInput.parse({ equipment, qty: '2', unit: 'ea', visibility, internalEstimate: estimate })
  await addLines(rfpId, [l('Shared string', 'shared', '777777'), l(`${SECRET} line`, 'internal', '1')])
  await addLines(otherRfpId, [l('Other RFP line', 'shared', '')])
  const lines = await db.select().from(lineItems)
  sharedLine = lines.find((x) => x.equipment === 'Shared string')!.id
  internalLine = lines.find((x) => x.equipment.startsWith(SECRET))!.id
  otherRfpLine = lines.find((x) => x.equipment === 'Other RFP line')!.id
  const f = await recordAttachment({ rfpId, name: 'spec.pdf', storageKey: 'k-shared', contentType: 'application/pdf', size: 1, uploadedBy: staff })
  await db.execute(sql`update attachments set visibility = 'shared' where id = ${f}`)
  await recordAttachment({ rfpId, name: `${SECRET}.xlsx`, storageKey: 'k-internal', contentType: 'x', size: 1, uploadedBy: staff })

  await sendInvites({ rfpId, supplierIds: [A, B], allContacts: false, staffId: staff, origin: 'https://rfp.example' })
})
afterAll(() => pool.end())

describe('sending invites', () => {
  it('sends exactly one invite per selected supplier and none to anyone else', async () => {
    const rows = await db.select().from(invites).where(eq(invites.rfpId, rfpId))
    expect(rows.map((r) => r.supplierId).sort()).toEqual([A, B].sort())
    expect(sent.mails.map((m) => m.to).sort()).toEqual(['a1@alpha.example', 'b1@beta.example'])
    expect(sent.mails.some((m) => m.to.includes('gamma'))).toBe(false)
  })

  it('emails each contact separately, never naming another supplier', () => {
    for (const m of sent.mails) {
      expect(m.to.split(',')).toHaveLength(1)
      const others = ['Alpha Power', 'Beta Cells', 'Gamma Cooling'].filter((c) => !m.text.startsWith(c))
      for (const o of others) expect(m.text).not.toContain(o)
    }
  })

  it('never re-sends to a supplier already invited, and can reach every contact on request', async () => {
    const r = await sendInvites({ rfpId, supplierIds: [A, B, C], allContacts: true, staffId: staff, origin: 'https://rfp.example' })
    expect(r).toMatchObject({ invited: 1, alreadyInvited: 2 })
    expect(sent.mails.filter((m) => m.to.includes('alpha'))).toHaveLength(1)
  })

  it('stores only a hash of each link token', async () => {
    const token = tokenFor('a1@alpha.example')!
    const all = JSON.stringify(await db.select().from(inviteLinks))
    expect(all).not.toContain(token)
  })

  it('opens the RFP and freezes what suppliers were sent', async () => {
    expect((await db.select().from(rfps).where(eq(rfps.id, rfpId)))[0].status).toBe('open')
    await expect(addLines(rfpId, [lineInput.parse({ equipment: 'x', qty: '1', unit: 'ea' })])).rejects.toBeInstanceOf(RfpLocked)
    const r = (await db.select().from(rfps).where(eq(rfps.id, rfpId)))[0]
    await expect(updateRfp(rfpId, { ...r, description: 'changed' })).rejects.toBeInstanceOf(RfpLocked)
    // Internal notes remain editable: suppliers never see them.
    expect(await updateRfp(rfpId, { ...r, internalNotes: 'new notes' })).toBe(true)
  })

  it('refuses to send an RFP with nothing shared, no due date, or a past one', async () => {
    const empty = await createRfp({ type: 'RFP', title: 'Empty', description: '', internalNotes: '', dueAt: null, sealed: true }, staff)
    expect((await sendBlockers(empty)).join(' ')).toMatch(/due date.*Share at least one line/)
    await expect(sendInvites({ rfpId: empty, supplierIds: [C], allContacts: false, staffId: staff, origin: 'x' })).rejects.toThrow()
  })
})

describe('supplier isolation', () => {
  it("A's link opens A's invite and B's opens B's", async () => {
    const { access: a } = await enter('a1@alpha.example')
    const { access: b } = await enter('b1@beta.example')
    expect(a.supplierId).toBe(A)
    expect(b.supplierId).toBe(B)
    expect(a.inviteId).not.toBe(b.inviteId)
  })

  it("A's token presented at B's link address matches nothing, and the reverse", async () => {
    const a = await enter('a1@alpha.example')
    const b = await enter('b1@beta.example')
    expect(await portalAccess(b.access.linkId, a.token)).toBeNull()
    expect(await portalAccess(a.access.linkId, b.token)).toBeNull()
    expect(await portalAccess(a.access.linkId, a.token)).not.toBeNull()
  })

  it("A can never read B's bids", async () => {
    const a = (await enter('a1@alpha.example')).access
    const b = (await enter('b1@beta.example')).access
    await saveBids(b, [{ lineItemId: sharedLine, unitPrice: '424242', leadTimeDays: '30', notes: 'B secret terms' }], { submit: true })
    await saveBids(a, [{ lineItemId: sharedLine, unitPrice: '100', leadTimeDays: '', notes: '' }], { submit: false })

    const aSees = JSON.stringify({ rfp: await getSupplierSafeRfp(a.rfpId), bids: await ownBids(a), submitted: await ownSubmission(a) })
    expect(aSees).not.toContain('424242')
    expect(aSees).not.toContain('B secret terms')
    expect(await ownBids(a)).toEqual([expect.objectContaining({ unitPrice: '100.00' })])
    expect(await ownSubmission(a)).toBeNull()
  })

  it('nothing a supplier is shown carries an internal field, line, estimate or file', async () => {
    const a = (await enter('a1@alpha.example')).access
    const shown = JSON.stringify({ rfp: await getSupplierSafeRfp(a.rfpId), bids: await ownBids(a), access: a })
    expect(shown).not.toContain(SECRET)
    expect(shown).not.toContain('777777')
    const files = await db.execute(sql`select id, visibility from attachments where rfp_id = ${rfpId}`)
    for (const f of files.rows as { id: string; visibility: string }[]) {
      const got = await sharedAttachmentForDownload(a.rfpId, f.id)
      expect(Boolean(got)).toBe(f.visibility === 'shared')
    }
  })

  it('refuses bids on an internal line, or on a line from another RFP', async () => {
    const a = (await enter('a1@alpha.example')).access
    await expect(saveBids(a, [{ lineItemId: internalLine, unitPrice: '1' }], { submit: false })).rejects.toBeInstanceOf(BidRefused)
    await expect(saveBids(a, [{ lineItemId: otherRfpLine, unitPrice: '1' }], { submit: false })).rejects.toBeInstanceOf(BidRefused)
    expect(await db.select().from(bids)).toHaveLength(0)
  })
})

describe('links that should not work', () => {
  it('a revoked invite shows nothing, to any of its links', async () => {
    const a = await enter('a1@alpha.example')
    await revokeInvite(rfpId, a.access.inviteId, staff)
    expect(await portalAccess(a.access.linkId, a.token)).toBeNull()
    expect(await enterPortal(a.token)).toBeNull()
  })

  it('a reissued link replaces the old one, which stops working', async () => {
    const old = await enter('a1@alpha.example')
    await reissueLink(rfpId, old.access.linkId, staff, 'https://rfp.example')
    expect(await portalAccess(old.access.linkId, old.token)).toBeNull()
    const fresh = await enter('a1@alpha.example')
    expect(fresh.token).not.toBe(old.token)
    expect(fresh.access.inviteId).toBe(old.access.inviteId)
  })

  it('an expired link shows nothing', async () => {
    const a = await enter('a1@alpha.example')
    const later = new Date(Date.now() + 60 * DAY)
    expect(await portalAccess(a.access.linkId, a.token, later)).toBeNull()
  })

  it('after the due date a link still shows the request but takes no bids', async () => {
    const a = await enter('a1@alpha.example')
    const afterDue = new Date(Date.now() + 8 * DAY)
    const late = (await portalAccess(a.access.linkId, a.token, afterDue))!
    expect(late.canBid).toBe(false)
    await expect(saveBids(late, [{ lineItemId: sharedLine, unitPrice: '1' }], { submit: true })).rejects.toThrow(/closed/)
  })

  it('malformed tokens and ids are simply no access', async () => {
    expect(await enterPortal('short')).toBeNull()
    expect(await portalAccess('not-a-uuid', 'x'.repeat(43))).toBeNull()
    expect(await portalAccess('00000000-0000-4000-8000-000000000000', undefined)).toBeNull()
  })
})

describe('submitting', () => {
  it('is final for the round, and the database enforces it', async () => {
    const a = (await enter('a1@alpha.example')).access
    await saveBids(a, [{ lineItemId: sharedLine, unitPrice: '1,200.50', leadTimeDays: '45' }], { submit: true })
    expect(await ownSubmission(a)).not.toBeNull()
    await expect(saveBids(a, [{ lineItemId: sharedLine, unitPrice: '1' }], { submit: false })).rejects.toThrow(/already been submitted/)
    await expect(db.update(bids).set({ unitPrice: '1' }).where(eq(bids.inviteId, a.inviteId))).rejects.toThrow()
    expect((await ownBids(a))[0]).toMatchObject({ unitPrice: '1200.50', leadTimeDays: 45 })
  })

  it('needs at least one priced line', async () => {
    const a = (await enter('a1@alpha.example')).access
    await expect(saveBids(a, [{ lineItemId: sharedLine, unitPrice: '' }], { submit: true })).rejects.toThrow(/at least one line/)
  })

  it('shows up on the tracker as a date, with no amounts anywhere on it', async () => {
    const a = (await enter('a1@alpha.example')).access
    await saveBids(a, [{ lineItemId: sharedLine, unitPrice: '98765' }], { submit: true })
    const rows = await inviteTracker(rfpId)
    expect(rows.find((r) => r.supplierId === A)!.submittedAt).not.toBeNull()
    expect(rows.find((r) => r.supplierId === B)!.submittedAt).toBeNull()
    expect(JSON.stringify(rows)).not.toContain('98765')
  })
})

describe('activity log', () => {
  it('records sends, entries and submissions, and never an amount', async () => {
    const a = (await enter('a1@alpha.example')).access
    await saveBids(a, [{ lineItemId: sharedLine, unitPrice: '55555' }], { submit: true })
    const log = await db.select().from(activityLog).where(eq(activityLog.rfpId, rfpId))
    const actions = log.map((l) => l.action)
    expect(actions.filter((x) => x === 'invite.sent')).toHaveLength(2)
    expect(actions).toEqual(expect.arrayContaining(['portal.entered', 'bid.submitted']))
    expect(JSON.stringify(log)).not.toContain('55555')
    const submitted = log.find((l) => l.action === 'bid.submitted')!
    expect(submitted).toMatchObject({ actorType: 'supplier', actorId: a.linkId })
  })

  it('cannot be edited or deleted, even directly', async () => {
    await expect(db.update(activityLog).set({ action: 'x' })).rejects.toThrow()
    await expect(db.delete(activityLog).where(and(eq(activityLog.rfpId, rfpId)))).rejects.toThrow()
  })
})
