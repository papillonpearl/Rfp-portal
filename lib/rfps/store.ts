import 'server-only'
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { attachments, lineItems, rfps } from '@/lib/db/schema'
import type { LineInput, RfpInput } from './validation'

// Admin-side reads and writes. Supplier routes must never import this file:
// it returns internal fields by design. They use supplier-safe.ts.
//
// Every write to a line or attachment is scoped by BOTH its id and its RFP's
// id, so a forged id from another RFP matches nothing.

/**
 * Once invites have gone out, what suppliers were sent must not quietly
 * change under them. Lines, attachments and the shared details are frozen;
 * a change after that point is an addendum (Phase 4), announced to every
 * invitee. Internal notes stay editable: suppliers never see them.
 */
export class RfpLocked extends Error {
  constructor() {
    super('Invites have been sent, so this can no longer change. Changes from here are addenda.')
  }
}

async function assertDraft(rfpId: string, exec: Pick<typeof db, 'select'> = db) {
  const [row] = await exec.select({ status: rfps.status }).from(rfps).where(eq(rfps.id, rfpId))
  if (row && row.status !== 'draft') throw new RfpLocked()
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID.test(s)

export async function listRfps() {
  return db
    .select({
      id: rfps.id,
      title: rfps.title,
      type: rfps.type,
      status: rfps.status,
      dueAt: rfps.dueAt,
      sealed: rfps.sealed,
      lineCount: sql<number>`(select count(*)::int from ${lineItems} l where l.rfp_id = "rfps"."id")`,
      sharedLineCount: sql<number>`(select count(*)::int from ${lineItems} l where l.rfp_id = "rfps"."id" and l.visibility = 'shared')`,
    })
    .from(rfps)
    .orderBy(desc(rfps.createdAt))
}

export async function getRfp(id: string) {
  if (!isUuid(id)) return undefined
  const [rfp] = await db.select().from(rfps).where(eq(rfps.id, id))
  if (!rfp) return undefined
  const [lines, files] = await Promise.all([
    db.select().from(lineItems).where(eq(lineItems.rfpId, id)).orderBy(asc(lineItems.position)),
    db.select().from(attachments).where(eq(attachments.rfpId, id)).orderBy(asc(attachments.createdAt)),
  ])
  return { ...rfp, lines, attachments: files }
}

export async function createRfp(input: RfpInput, userId: string): Promise<string> {
  const [row] = await db
    .insert(rfps)
    .values({ ...input, createdBy: userId })
    .returning({ id: rfps.id })
  return row.id
}

export async function updateRfp(id: string, input: RfpInput): Promise<boolean> {
  const [current] = await db.select().from(rfps).where(eq(rfps.id, id))
  if (!current) return false
  if (current.status !== 'draft') {
    const changed =
      current.title !== input.title ||
      current.type !== input.type ||
      current.description !== input.description ||
      current.sealed !== input.sealed ||
      (current.dueAt?.getTime() ?? null) !== (input.dueAt?.getTime() ?? null)
    if (changed) throw new RfpLocked()
    await db.update(rfps).set({ internalNotes: input.internalNotes, updatedAt: new Date() }).where(eq(rfps.id, id))
    return true
  }
  const r = await db
    .update(rfps)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(rfps.id, id))
    .returning({ id: rfps.id })
  return r.length > 0
}

async function touch(rfpId: string) {
  await db.update(rfps).set({ updatedAt: new Date() }).where(eq(rfps.id, rfpId))
}

/** Appends lines in order after any already on the RFP. One transaction. */
export async function addLines(rfpId: string, lines: LineInput[]): Promise<number> {
  if (lines.length === 0) return 0
  await db.transaction(async (tx) => {
    // Lock the RFP row so two uploads at once cannot interleave positions.
    const locked = await tx.execute(sql`select id from rfps where id = ${rfpId} for update`)
    if (locked.rows.length === 0) throw new Error('RFP not found')
    await assertDraft(rfpId, tx)
    const [{ top }] = await tx
      .select({ top: max(lineItems.position) })
      .from(lineItems)
      .where(eq(lineItems.rfpId, rfpId))
    const start = (top ?? 0) + 1
    await tx.insert(lineItems).values(lines.map((l, i) => ({ ...l, rfpId, position: start + i })))
  })
  await touch(rfpId)
  return lines.length
}

export async function updateLine(rfpId: string, lineId: string, input: LineInput): Promise<boolean> {
  if (!isUuid(lineId)) return false
  await assertDraft(rfpId)
  const r = await db
    .update(lineItems)
    .set(input)
    .where(and(eq(lineItems.id, lineId), eq(lineItems.rfpId, rfpId)))
    .returning({ id: lineItems.id })
  if (r.length) await touch(rfpId)
  return r.length > 0
}

export async function setLineVisibility(rfpId: string, lineIds: string[], v: 'internal' | 'shared') {
  const ids = lineIds.filter(isUuid)
  if (ids.length === 0) return 0
  await assertDraft(rfpId)
  const r = await db
    .update(lineItems)
    .set({ visibility: v })
    .where(and(eq(lineItems.rfpId, rfpId), inArray(lineItems.id, ids)))
    .returning({ id: lineItems.id })
  if (r.length) await touch(rfpId)
  return r.length
}

export async function deleteLine(rfpId: string, lineId: string): Promise<boolean> {
  if (!isUuid(lineId)) return false
  await assertDraft(rfpId)
  const r = await db
    .delete(lineItems)
    .where(and(eq(lineItems.id, lineId), eq(lineItems.rfpId, rfpId)))
    .returning({ id: lineItems.id })
  if (r.length) await touch(rfpId)
  return r.length > 0
}

export async function recordAttachment(values: {
  rfpId: string
  name: string
  storageKey: string
  contentType: string
  size: number
  uploadedBy: string
}): Promise<string> {
  await assertDraft(values.rfpId)
  const [row] = await db.insert(attachments).values(values).returning({ id: attachments.id })
  await touch(values.rfpId)
  return row.id
}

export async function getAttachment(rfpId: string, attachmentId: string) {
  if (!isUuid(attachmentId) || !isUuid(rfpId)) return undefined
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.rfpId, rfpId)))
  return row
}

export async function setAttachmentVisibility(rfpId: string, attachmentId: string, v: 'internal' | 'shared') {
  if (!isUuid(attachmentId)) return false
  await assertDraft(rfpId)
  const r = await db
    .update(attachments)
    .set({ visibility: v })
    .where(and(eq(attachments.id, attachmentId), eq(attachments.rfpId, rfpId)))
    .returning({ id: attachments.id })
  if (r.length) await touch(rfpId)
  return r.length > 0
}

/** Removes the row and returns its storage key, for the caller to delete the bytes. */
export async function deleteAttachment(rfpId: string, attachmentId: string): Promise<string | undefined> {
  if (!isUuid(attachmentId)) return undefined
  await assertDraft(rfpId)
  const [row] = await db
    .delete(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.rfpId, rfpId)))
    .returning({ storageKey: attachments.storageKey })
  if (row) await touch(rfpId)
  return row?.storageKey
}
