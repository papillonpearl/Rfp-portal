import 'server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  invites,
  inviteLinks,
  lineItems,
  rfps,
  roundSubmissions,
  supplierContacts,
  suppliers,
} from '@/lib/db/schema'
import { logActivity } from '@/lib/activity'
import { sendMailBatch, type Mail } from '@/lib/email'
import { newPortalToken } from '@/lib/portal/tokens'
import { isUuid } from '@/lib/rfps/store'

// Admin side of invitations. Supplier-facing code never imports this.

/** Links keep working (read-only) this long after the due date, then stop. */
export const LINK_GRACE_DAYS = 30

export type Candidate = {
  supplierId: string
  company: string
  category: string
  region: string | null
  primaryEmail: string | null
  contactCount: number
  invited: boolean
}

export async function inviteCandidates(rfpId: string): Promise<Candidate[]> {
  return db
    .select({
      supplierId: suppliers.id,
      company: suppliers.company,
      category: suppliers.category,
      region: suppliers.region,
      primaryEmail: sql<string | null>`(select c.email from ${supplierContacts} c where c.supplier_id = "suppliers"."id" and c.is_primary)`,
      contactCount: sql<number>`(select count(*)::int from ${supplierContacts} c where c.supplier_id = "suppliers"."id")`,
      invited: sql<boolean>`exists (select 1 from ${invites} i where i.supplier_id = "suppliers"."id" and i.rfp_id = ${rfpId})`,
    })
    .from(suppliers)
    .where(eq(suppliers.status, 'active'))
    .orderBy(asc(suppliers.category), asc(sql`lower(${suppliers.company})`))
}

/** Why an RFP cannot go out yet, in words; empty when it can. */
export async function sendBlockers(rfpId: string): Promise<string[]> {
  const [rfp] = await db.select().from(rfps).where(eq(rfps.id, rfpId))
  if (!rfp) return ['RFP not found']
  const out: string[] = []
  if (!rfp.dueAt) out.push('Set a due date first.')
  else if (rfp.dueAt.getTime() <= Date.now()) out.push('The due date has passed. Set a later one first.')
  if (rfp.status === 'closed' || rfp.status === 'awarded') out.push(`The RFP is ${rfp.status}.`)
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lineItems)
    .where(and(eq(lineItems.rfpId, rfpId), eq(lineItems.visibility, 'shared')))
  if (n === 0) out.push('Share at least one line item: suppliers would receive nothing to price.')
  return out
}

export type SendResult = {
  invited: number
  alreadyInvited: number
  emailed: number
  failed: string[]
  noContact: string[]
}

type NewLink = { linkId: string; email: string; token: string; company: string }

function inviteMail(link: NewLink, rfp: { title: string; type: string; dueAt: Date }, origin: string): Mail {
  // The token rides in the fragment: it never reaches a server log, and the
  // entry page swaps it for a cookie before anything is shown.
  const url = `${origin}/portal/enter#${link.token}`
  const due = rfp.dueAt.toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
  const subject = `Invitation to respond: ${rfp.title} (${rfp.type})`
  const text = [
    `${link.company} is invited to respond to "${rfp.title}".`,
    '',
    `Responses are due ${due} UTC.`,
    '',
    `Open your response page: ${url}`,
    '',
    'This link is for you alone. Please do not forward it; ask us for a link for a colleague instead.',
  ].join('\n')
  const html = `<p>${escape(link.company)} is invited to respond to <strong>${escape(rfp.title)}</strong>.</p>
<p>Responses are due <strong>${escape(due)} UTC</strong>.</p>
<p><a href="${url}">Open your response page</a></p>
<p style="color:#666">This link is for you alone. Please do not forward it; ask us for a link for a colleague instead.</p>`
  return { to: link.email, subject, text, html }
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * One invite per selected supplier, one link per emailed contact, one
 * separate email per link. Suppliers already invited are skipped, never
 * re-sent: re-sending is a deliberate per-contact action.
 */
export async function sendInvites(opts: {
  rfpId: string
  supplierIds: string[]
  allContacts: boolean
  staffId: string
  origin: string
}): Promise<SendResult> {
  const blockers = await sendBlockers(opts.rfpId)
  if (blockers.length) throw new Error(blockers.join(' '))
  const ids = [...new Set(opts.supplierIds.filter(isUuid))]
  const result: SendResult = { invited: 0, alreadyInvited: 0, emailed: 0, failed: [], noContact: [] }
  if (ids.length === 0) return result

  const [rfp] = await db.select().from(rfps).where(eq(rfps.id, opts.rfpId))
  const dueAt = rfp.dueAt!
  const expiresAt = new Date(dueAt.getTime() + LINK_GRACE_DAYS * 86_400_000)
  const created: NewLink[] = []

  await db.transaction(async (tx) => {
    const chosen = await tx
      .select({ id: suppliers.id, company: suppliers.company })
      .from(suppliers)
      .where(and(inArray(suppliers.id, ids), eq(suppliers.status, 'active')))
    const already = new Set(
      (
        await tx
          .select({ s: invites.supplierId })
          .from(invites)
          .where(and(eq(invites.rfpId, opts.rfpId), inArray(invites.supplierId, ids)))
      ).map((r) => r.s),
    )
    for (const s of chosen) {
      if (already.has(s.id)) {
        result.alreadyInvited++
        continue
      }
      const contacts = await tx
        .select()
        .from(supplierContacts)
        .where(
          opts.allContacts
            ? eq(supplierContacts.supplierId, s.id)
            : and(eq(supplierContacts.supplierId, s.id), eq(supplierContacts.isPrimary, true)),
        )
      if (contacts.length === 0) {
        result.noContact.push(s.company)
        continue
      }
      const [inv] = await tx
        .insert(invites)
        .values({ rfpId: opts.rfpId, supplierId: s.id, expiresAt, sentBy: opts.staffId })
        .returning({ id: invites.id })
      for (const c of contacts) {
        const { token, hash } = newPortalToken()
        const [link] = await tx
          .insert(inviteLinks)
          .values({ inviteId: inv.id, contactId: c.id, email: c.email, tokenHash: hash })
          .returning({ id: inviteLinks.id })
        created.push({ linkId: link.id, email: c.email, token, company: s.company })
      }
      result.invited++
      await logActivity(
        {
          actor: { type: 'staff', id: opts.staffId },
          rfpId: opts.rfpId,
          action: 'invite.sent',
          detail: { inviteId: inv.id, supplierId: s.id, links: contacts.length },
        },
        tx,
      )
    }
    // Sending is what opens the RFP, and opening is what freezes it.
    if (result.invited > 0) {
      await tx.update(rfps).set({ status: 'open', updatedAt: new Date() }).where(eq(rfps.id, opts.rfpId))
    }
  })

  // Email after the transaction: a mail provider cannot be rolled back, so
  // the invites exist first and each link records whether its email went.
  const sent = await sendMailBatch(created.map((l) => inviteMail(l, { ...rfp, dueAt }, opts.origin)))
  for (let i = 0; i < created.length; i++) {
    const r = sent[i]
    if (r.ok) result.emailed++
    else result.failed.push(created[i].email)
    await db.update(inviteLinks).set({ emailStatus: r.mode }).where(eq(inviteLinks.id, created[i].linkId))
  }
  if (result.failed.length) {
    await logActivity({
      actor: { type: 'system' },
      rfpId: opts.rfpId,
      action: 'invite.email_failed',
      detail: { count: result.failed.length },
    })
  }
  return result
}

export type TrackerRow = {
  inviteId: string
  supplierId: string
  company: string
  sentAt: Date
  openedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date
  submittedAt: Date | null
  links: { id: string; email: string; emailStatus: string; revokedAt: Date | null; lastUsedAt: Date | null }[]
}

/** Who was invited and how far each has got. No bid amounts, ever. */
export async function inviteTracker(rfpId: string): Promise<TrackerRow[]> {
  const [rfp] = await db.select({ round: rfps.currentRound }).from(rfps).where(eq(rfps.id, rfpId))
  if (!rfp) return []
  const rows = await db
    .select({
      inviteId: invites.id,
      supplierId: invites.supplierId,
      company: suppliers.company,
      sentAt: invites.sentAt,
      openedAt: invites.openedAt,
      revokedAt: invites.revokedAt,
      expiresAt: invites.expiresAt,
      submittedAt: roundSubmissions.submittedAt,
    })
    .from(invites)
    .innerJoin(suppliers, eq(suppliers.id, invites.supplierId))
    .leftJoin(
      roundSubmissions,
      and(eq(roundSubmissions.inviteId, invites.id), eq(roundSubmissions.round, rfp.round)),
    )
    .where(eq(invites.rfpId, rfpId))
    .orderBy(asc(sql`lower(${suppliers.company})`))
  if (rows.length === 0) return []
  const links = await db
    .select()
    .from(inviteLinks)
    .where(inArray(inviteLinks.inviteId, rows.map((r) => r.inviteId)))
    .orderBy(asc(inviteLinks.createdAt))
  return rows.map((r) => ({
    ...r,
    links: links
      .filter((l) => l.inviteId === r.inviteId)
      .map((l) => ({ id: l.id, email: l.email, emailStatus: l.emailStatus, revokedAt: l.revokedAt, lastUsedAt: l.lastUsedAt })),
  }))
}

/** Stops every link for one supplier on one RFP, at once. */
export async function revokeInvite(rfpId: string, inviteId: string, staffId: string): Promise<boolean> {
  if (!isUuid(inviteId)) return false
  const r = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, inviteId), eq(invites.rfpId, rfpId), isNull(invites.revokedAt)))
    .returning({ id: invites.id })
  if (r.length) {
    await logActivity({ actor: { type: 'staff', id: staffId }, rfpId, action: 'invite.revoked', detail: { inviteId } })
  }
  return r.length > 0
}

/**
 * A fresh link to the same address, and the old one revoked. The old token
 * cannot be re-sent because it was never stored.
 */
export async function reissueLink(
  rfpId: string,
  linkId: string,
  staffId: string,
  origin: string,
): Promise<{ ok: boolean; emailed: boolean }> {
  if (!isUuid(linkId)) return { ok: false, emailed: false }
  const [row] = await db
    .select({
      link: inviteLinks,
      invite: invites,
      company: suppliers.company,
      rfp: rfps,
    })
    .from(inviteLinks)
    .innerJoin(invites, eq(invites.id, inviteLinks.inviteId))
    .innerJoin(suppliers, eq(suppliers.id, invites.supplierId))
    .innerJoin(rfps, eq(rfps.id, invites.rfpId))
    .where(and(eq(inviteLinks.id, linkId), eq(invites.rfpId, rfpId)))
  if (!row || row.invite.revokedAt || !row.rfp.dueAt) return { ok: false, emailed: false }

  const { token, hash } = newPortalToken()
  const newId = await db.transaction(async (tx) => {
    await tx.update(inviteLinks).set({ revokedAt: new Date() }).where(and(eq(inviteLinks.id, linkId), isNull(inviteLinks.revokedAt)))
    const [created] = await tx
      .insert(inviteLinks)
      .values({ inviteId: row.invite.id, contactId: row.link.contactId, email: row.link.email, tokenHash: hash })
      .returning({ id: inviteLinks.id })
    await logActivity(
      { actor: { type: 'staff', id: staffId }, rfpId, action: 'link.reissued', detail: { inviteId: row.invite.id, oldLinkId: linkId, newLinkId: created.id } },
      tx,
    )
    return created.id
  })
  const [sent] = await sendMailBatch([
    inviteMail({ linkId: newId, email: row.link.email, token, company: row.company }, { ...row.rfp, dueAt: row.rfp.dueAt }, origin),
  ])
  await db.update(inviteLinks).set({ emailStatus: sent.mode }).where(eq(inviteLinks.id, newId))
  return { ok: true, emailed: sent.ok }
}
