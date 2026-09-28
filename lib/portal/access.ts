import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { invites, inviteLinks, rfps, suppliers } from '@/lib/db/schema'
import { logActivity } from '@/lib/activity'
import { hashPortalToken, PORTAL_TOKEN_SHAPE } from './tokens'

// WHO a portal request is. Every supplier-facing page, action and download
// starts here, and everything after it is scoped by what this returns —
// never by an id the browser sent.

export type PortalAccess = {
  linkId: string
  inviteId: string
  rfpId: string
  supplierId: string
  company: string
  email: string
  round: number
  dueAt: Date
  /** True while bids can still be saved and submitted. */
  canBid: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function lookup(where: ReturnType<typeof and>) {
  const [row] = await db
    .select({
      linkId: inviteLinks.id,
      linkRevokedAt: inviteLinks.revokedAt,
      inviteId: invites.id,
      inviteRevokedAt: invites.revokedAt,
      expiresAt: invites.expiresAt,
      openedAt: invites.openedAt,
      rfpId: rfps.id,
      status: rfps.status,
      dueAt: rfps.dueAt,
      round: rfps.currentRound,
      supplierId: suppliers.id,
      company: suppliers.company,
      email: inviteLinks.email,
    })
    .from(inviteLinks)
    .innerJoin(invites, eq(invites.id, inviteLinks.inviteId))
    .innerJoin(rfps, eq(rfps.id, invites.rfpId))
    .innerJoin(suppliers, eq(suppliers.id, invites.supplierId))
    .where(where)
  return row
}

type Row = NonNullable<Awaited<ReturnType<typeof lookup>>>

/** Revoked, expired or never opened for bidding: all read as "no access". */
function usable(row: Row | undefined, now: Date): row is Row & { dueAt: Date } {
  return Boolean(
    row &&
      !row.linkRevokedAt &&
      !row.inviteRevokedAt &&
      row.expiresAt > now &&
      row.status !== 'draft' &&
      row.dueAt,
  )
}

function toAccess(row: Row & { dueAt: Date }, now: Date): PortalAccess {
  return {
    linkId: row.linkId,
    inviteId: row.inviteId,
    rfpId: row.rfpId,
    supplierId: row.supplierId,
    company: row.company,
    email: row.email,
    round: row.round,
    dueAt: row.dueAt,
    canBid: row.status === 'open' && now < row.dueAt,
  }
}

/**
 * Redeem an emailed token: the one moment the raw token is presented. The
 * caller stores it in an httpOnly cookie scoped to this link's path.
 * Records the first open, and every entry, in the log.
 */
export async function enterPortal(token: string, now = new Date()): Promise<PortalAccess | null> {
  if (!PORTAL_TOKEN_SHAPE.test(token)) return null
  const row = await lookup(and(eq(inviteLinks.tokenHash, hashPortalToken(token))))
  if (!usable(row, now)) return null
  await db.update(inviteLinks).set({ lastUsedAt: now }).where(eq(inviteLinks.id, row.linkId))
  if (!row.openedAt) {
    await db.update(invites).set({ openedAt: now }).where(and(eq(invites.id, row.inviteId), isNull(invites.openedAt)))
  }
  await logActivity({
    actor: { type: 'supplier', id: row.linkId },
    rfpId: row.rfpId,
    action: 'portal.entered',
    detail: { inviteId: row.inviteId, first: !row.openedAt },
  })
  return toAccess(row, now)
}

/**
 * Every later request: the link id from the URL AND the token from its
 * cookie must belong together. A cookie for link A presented at link B's
 * address matches nothing, because both conditions are in one query.
 */
export async function portalAccess(linkId: string, token: string | undefined, now = new Date()): Promise<PortalAccess | null> {
  if (!token || !UUID.test(linkId) || !PORTAL_TOKEN_SHAPE.test(token)) return null
  const row = await lookup(and(eq(inviteLinks.id, linkId), eq(inviteLinks.tokenHash, hashPortalToken(token))))
  if (!usable(row, now)) return null
  return toAccess(row, now)
}

/** Marks activity on a link without logging a whole event. */
export async function touchLink(linkId: string, now = new Date()) {
  await db.update(inviteLinks).set({ lastUsedAt: now }).where(eq(inviteLinks.id, linkId))
}

