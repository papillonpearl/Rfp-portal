import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { attachments, lineItems, rfps } from '@/lib/db/schema'
import { isUuid } from './store'

// THE ONLY WAY SUPPLIER-FACING CODE READS AN RFP.
//
// It SELECTS shared fields by name; it never loads a whole row and deletes
// the internal parts. Stripping is a list of things to remember to remove,
// and the column added next month is not on it. Selecting is a list of
// things allowed out, and a new column is internal until someone adds it
// here on purpose.
//
// It says nothing about WHO may see the RFP. From Phase 3 the portal route
// checks the supplier's invite first and calls this second.

export type SupplierSafeLine = {
  id: string
  position: number
  site: string | null
  equipment: string
  spec: string
  qty: string
  unit: string
}

export type SupplierSafeAttachment = {
  id: string
  name: string
  contentType: string
  size: number
}

export type SupplierSafeRfp = {
  id: string
  title: string
  type: 'RFP' | 'RFQ'
  description: string
  dueAt: Date | null
  currentRound: number
  lines: SupplierSafeLine[]
  attachments: SupplierSafeAttachment[]
}

export async function getSupplierSafeRfp(rfpId: string): Promise<SupplierSafeRfp | null> {
  if (!isUuid(rfpId)) return null
  const [rfp] = await db
    .select({
      id: rfps.id,
      title: rfps.title,
      type: rfps.type,
      description: rfps.description,
      dueAt: rfps.dueAt,
      currentRound: rfps.currentRound,
    })
    .from(rfps)
    .where(eq(rfps.id, rfpId))
  if (!rfp) return null

  const lines = await db
    .select({
      id: lineItems.id,
      position: lineItems.position,
      site: lineItems.site,
      equipment: lineItems.equipment,
      spec: lineItems.spec,
      qty: lineItems.qty,
      unit: lineItems.unit,
    })
    .from(lineItems)
    .where(and(eq(lineItems.rfpId, rfpId), eq(lineItems.visibility, 'shared')))
    .orderBy(asc(lineItems.position))

  const files = await db
    .select({
      id: attachments.id,
      name: attachments.name,
      contentType: attachments.contentType,
      size: attachments.size,
    })
    .from(attachments)
    .where(and(eq(attachments.rfpId, rfpId), eq(attachments.visibility, 'shared')))
    .orderBy(asc(attachments.createdAt))

  return { ...rfp, lines, attachments: files }
}

/**
 * For a download route to stream a SHARED attachment's bytes. Returns the
 * storage key, so its result stays on the server and is never rendered.
 */
export async function sharedAttachmentForDownload(rfpId: string, attachmentId: string) {
  if (!isUuid(rfpId) || !isUuid(attachmentId)) return null
  const [row] = await db
    .select({ name: attachments.name, contentType: attachments.contentType, storageKey: attachments.storageKey })
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.rfpId, rfpId),
        eq(attachments.visibility, 'shared'),
      ),
    )
  return row ?? null
}
