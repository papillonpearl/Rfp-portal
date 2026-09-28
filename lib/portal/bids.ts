import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { bids, roundSubmissions } from '@/lib/db/schema'
import { logActivity } from '@/lib/activity'
import { getSupplierSafeRfp } from '@/lib/rfps/supplier-safe'
import { parseDecimal } from '@/lib/rfps/validation'
import type { PortalAccess } from './access'

// A supplier's own bids. Every read and write is keyed on access.inviteId,
// which came from the verified link — so there is no parameter here through
// which another supplier's bids could even be named.

export type OwnBid = {
  lineItemId: string
  unitPrice: string | null
  leadTimeDays: number | null
  notes: string
  submittedAt: Date | null
}

export async function ownBids(access: PortalAccess): Promise<OwnBid[]> {
  return db
    .select({
      lineItemId: bids.lineItemId,
      unitPrice: bids.unitPrice,
      leadTimeDays: bids.leadTimeDays,
      notes: bids.notes,
      submittedAt: bids.submittedAt,
    })
    .from(bids)
    .where(and(eq(bids.inviteId, access.inviteId), eq(bids.round, access.round)))
}

export async function ownSubmission(access: PortalAccess): Promise<Date | null> {
  const [row] = await db
    .select({ at: roundSubmissions.submittedAt })
    .from(roundSubmissions)
    .where(and(eq(roundSubmissions.inviteId, access.inviteId), eq(roundSubmissions.round, access.round)))
  return row?.at ?? null
}

const entry = z.object({
  lineItemId: z.uuid(),
  // .optional() before .transform(): in Zod 4 a transformed unknown is
  // otherwise required, and a missing field is refused rather than empty.
  unitPrice: z.unknown().optional().transform((v, ctx) => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null
    const d = parseDecimal(v, 2)
    if (d === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Unit prices must be amounts like 1200 or 1,200.50' })
      return z.NEVER
    }
    return d
  }),
  leadTimeDays: z.unknown().optional().transform((v, ctx) => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null
    const s = String(v).trim()
    if (!/^\d{1,4}$/.test(s) || Number(s) > 3650) {
      ctx.addIssue({ code: 'custom', message: 'Lead times must be whole days, 0 to 3650' })
      return z.NEVER
    }
    return Number(s)
  }),
  notes: z
    .string()
    .nullish()
    .transform((s) => (s ?? '').trim())
    .pipe(z.string().max(2000, 'Notes are limited to 2,000 characters per line')),
})
export const bidEntries = z.array(entry).max(2000)
export type BidEntry = z.output<typeof entry>

export class BidRefused extends Error {}

/**
 * Save a draft, or submit. Submission is final for the round: the rows are
 * stamped and the database refuses any later change to them (migration
 * 0003). A revision is a new round, opened by the team (Phase 4).
 */
export async function saveBids(
  access: PortalAccess,
  raw: unknown,
  opts: { submit: boolean },
  now = new Date(),
): Promise<{ saved: number; submitted: boolean }> {
  if (!access.canBid) throw new BidRefused('Bidding is closed for this request.')
  const parsed = bidEntries.safeParse(raw)
  if (!parsed.success) throw new BidRefused([...new Set(parsed.error.issues.map((i) => i.message))].join(' '))

  // Only lines this supplier can see may be bid on: shared lines of this
  // invite's own RFP. An internal line's id, or another RFP's, is refused.
  const rfp = await getSupplierSafeRfp(access.rfpId)
  const visible = new Set(rfp?.lines.map((l) => l.id) ?? [])
  const entries = parsed.data
  if (entries.some((e) => !visible.has(e.lineItemId))) throw new BidRefused('That response names a line that is not in this request.')
  if (new Set(entries.map((e) => e.lineItemId)).size !== entries.length) throw new BidRefused('A line appears twice.')
  if (opts.submit && !entries.some((e) => e.unitPrice !== null)) throw new BidRefused('Price at least one line before submitting.')

  return db.transaction(async (tx) => {
    // One submission per supplier per round, checked under a lock so a
    // double-click cannot submit twice.
    await tx.execute(sql`select id from invites where id = ${access.inviteId} for update`)
    const [done] = await tx
      .select({ id: roundSubmissions.id })
      .from(roundSubmissions)
      .where(and(eq(roundSubmissions.inviteId, access.inviteId), eq(roundSubmissions.round, access.round)))
    if (done) throw new BidRefused('This round has already been submitted.')

    for (const e of entries) {
      await tx
        .insert(bids)
        .values({
          inviteId: access.inviteId,
          lineItemId: e.lineItemId,
          round: access.round,
          unitPrice: e.unitPrice,
          leadTimeDays: e.leadTimeDays,
          notes: e.notes,
          updatedAt: now,
          updatedByLink: access.linkId,
        })
        .onConflictDoUpdate({
          target: [bids.inviteId, bids.lineItemId, bids.round],
          set: {
            unitPrice: e.unitPrice,
            leadTimeDays: e.leadTimeDays,
            notes: e.notes,
            updatedAt: now,
            updatedByLink: access.linkId,
          },
          setWhere: isNull(bids.submittedAt),
        })
    }
    if (opts.submit) {
      await tx
        .update(bids)
        .set({ submittedAt: now })
        .where(and(eq(bids.inviteId, access.inviteId), eq(bids.round, access.round), isNull(bids.submittedAt)))
      await tx.insert(roundSubmissions).values({
        inviteId: access.inviteId,
        round: access.round,
        submittedAt: now,
        submittedByLink: access.linkId,
      })
    }
    // Counts only. Amounts never enter the log: staff read it, and a sealed
    // bid must not be readable there.
    await logActivity(
      {
        actor: { type: 'supplier', id: access.linkId },
        rfpId: access.rfpId,
        action: opts.submit ? 'bid.submitted' : 'bid.draft_saved',
        detail: {
          inviteId: access.inviteId,
          round: access.round,
          lines: entries.length,
          priced: entries.filter((e) => e.unitPrice !== null).length,
        },
      },
      tx,
    )
    return { saved: entries.length, submitted: opts.submit }
  })
}
