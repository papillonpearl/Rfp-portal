'use server'

import { revalidatePath } from 'next/cache'
import { BidRefused, saveBids } from '@/lib/portal/bids'
import { requirePortalAccess } from '@/lib/portal/session'

// Supplier-side actions. Each resolves access from the link's own cookie
// first; nothing the form sends can choose which invite is written to.

export type BidState = { ok: boolean; message: string } | undefined

export async function saveBidsAction(_prev: BidState, fd: FormData): Promise<BidState> {
  const linkId = String(fd.get('linkId') ?? '')
  const access = await requirePortalAccess(linkId)
  if (!access) return { ok: false, message: 'This link is no longer valid. Ask for a new one.' }

  const lineIds = fd.getAll('lineId').map(String)
  const entries = lineIds.map((id) => ({
    lineItemId: id,
    unitPrice: String(fd.get(`price:${id}`) ?? ''),
    leadTimeDays: String(fd.get(`lead:${id}`) ?? ''),
    notes: String(fd.get(`notes:${id}`) ?? ''),
  }))
  const submit = fd.get('intent') === 'submit'
  try {
    const r = await saveBids(access, entries, { submit })
    revalidatePath(`/portal/${linkId}`)
    return { ok: true, message: r.submitted ? 'Submitted. Thank you.' : `Draft saved (${r.saved} lines).` }
  } catch (e) {
    if (e instanceof BidRefused) return { ok: false, message: e.message }
    throw e
  }
}
