import 'server-only'
import { db } from '@/lib/db'
import { activityLog } from '@/lib/db/schema'

export type Actor =
  | { type: 'staff'; id: string }
  | { type: 'supplier'; id: string } // an invite link id: which person, not only which company
  | { type: 'system'; id?: undefined }

type Executor = Pick<typeof db, 'insert'>

/**
 * Append one entry. The table refuses updates and deletes at the database
 * (migration 0003), so this is the only thing that can happen to a row.
 * Detail holds ids and counts, never bid amounts: the log is read by staff,
 * and a sealed bid must not be readable through it.
 */
export async function logActivity(
  entry: { actor: Actor; rfpId: string | null; action: string; detail?: Record<string, unknown> },
  tx: Executor = db,
): Promise<void> {
  await tx.insert(activityLog).values({
    actorType: entry.actor.type,
    actorId: entry.actor.id ?? null,
    rfpId: entry.rfpId,
    action: entry.action,
    detail: entry.detail ?? {},
  })
}
