'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { Forbidden, requireAdmin, type Staff } from '@/lib/authz'
import {
  extensionOf,
  fileStore,
  isAllowedFile,
  MAX_ATTACHMENT_BYTES,
  newStorageKey,
} from '@/lib/files/store'
import { MAX_LINE_FILE_BYTES, planLines, readSheet, UnreadableFile, type LinePlan } from '@/lib/rfps/line-sheet'
import {
  addLines,
  createRfp,
  deleteAttachment,
  deleteLine,
  getRfp,
  isUuid,
  recordAttachment,
  RfpLocked,
  setAttachmentVisibility,
  setLineVisibility,
  updateLine,
  updateRfp,
} from '@/lib/rfps/store'
import { lineInput, rfpInput } from '@/lib/rfps/validation'
import { reissueLink, revokeInvite, sendInvites, type SendResult } from '@/lib/invites/store'

// Every action checks the caller's role itself (tests/authz.test.ts enforces
// it) and names the RFP it acts on; the store scopes every write by that id.

export type Errors = { errors: string[] } | undefined

async function admin(): Promise<Staff | { errors: string[] }> {
  try {
    return await requireAdmin()
  } catch (e) {
    if (e instanceof Forbidden) return { errors: ['Only admins can change RFPs'] }
    throw e
  }
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' ? v : ''
}

function rfpIdFrom(fd: FormData): string {
  const id = str(fd, 'rfpId')
  if (!isUuid(id)) throw new Error('Missing RFP id')
  return id
}

export async function saveRfp(_prev: Errors, fd: FormData): Promise<Errors> {
  const who = await admin()
  if ('errors' in who) return who
  const parsed = rfpInput.safeParse({
    title: str(fd, 'title'),
    type: str(fd, 'type'),
    description: str(fd, 'description'),
    internalNotes: str(fd, 'internalNotes'),
    dueAt: str(fd, 'dueAt') || null,
    sealed: fd.get('sealed') === 'on',
  })
  if (!parsed.success) return { errors: [...new Set(parsed.error.issues.map((i) => i.message))] }

  const existing = str(fd, 'rfpId')
  let id: string
  if (existing) {
    try {
      if (!isUuid(existing) || !(await updateRfp(existing, parsed.data))) return { errors: ['RFP not found'] }
    } catch (e) {
      if (e instanceof RfpLocked) return { errors: ['Invites have been sent, so only the internal notes can change. Other changes go out as an addendum.'] }
      throw e
    }
    id = existing
  } else {
    id = await createRfp(parsed.data, who.id)
  }
  revalidatePath('/rfps')
  redirect(`/rfps/${id}${existing ? '?saved=1' : ''}`)
}

function lineFromForm(fd: FormData) {
  return lineInput.safeParse({
    site: str(fd, 'site'),
    equipment: str(fd, 'equipment'),
    spec: str(fd, 'spec'),
    qty: str(fd, 'qty'),
    unit: str(fd, 'unit'),
    visibility: str(fd, 'visibility') === 'shared' ? 'shared' : 'internal',
    internalEstimate: str(fd, 'internalEstimate'),
  })
}

export async function saveLine(_prev: Errors, fd: FormData): Promise<Errors> {
  const who = await admin()
  if ('errors' in who) return who
  const rfpId = rfpIdFrom(fd)
  const parsed = lineFromForm(fd)
  if (!parsed.success) return { errors: [...new Set(parsed.error.issues.map((i) => i.message))] }
  const lineId = str(fd, 'lineId')
  try {
    if (lineId) {
      if (!(await updateLine(rfpId, lineId, parsed.data))) return { errors: ['Line not found'] }
    } else {
      await addLines(rfpId, [parsed.data])
    }
  } catch (e) {
    if (e instanceof RfpLocked) return { errors: [e.message] }
    throw e
  }
  revalidatePath(`/rfps/${rfpId}`)
  return { errors: [] }
}

export async function removeLine(fd: FormData): Promise<void> {
  const who = await admin()
  if ('errors' in who) return
  const rfpId = rfpIdFrom(fd)
  await deleteLine(rfpId, str(fd, 'lineId'))
  revalidatePath(`/rfps/${rfpId}`)
}

export async function changeLineVisibility(fd: FormData): Promise<void> {
  const who = await admin()
  if ('errors' in who) return
  const rfpId = rfpIdFrom(fd)
  const v = str(fd, 'visibility') === 'shared' ? 'shared' : 'internal'
  await setLineVisibility(rfpId, fd.getAll('lineId').map(String), v)
  revalidatePath(`/rfps/${rfpId}`)
}

// --- Line upload -----------------------------------------------------------

export type LineImportState =
  | { stage: 'idle' }
  | { stage: 'preview'; plan: LinePlan; fileName: string }
  | { stage: 'done'; added: number }
  | { stage: 'error'; message: string }

const committedLines = z.array(z.unknown()).min(1).max(2_000)

export async function importLines(_prev: LineImportState, fd: FormData): Promise<LineImportState> {
  const who = await admin()
  if ('errors' in who) return { stage: 'error', message: who.errors[0] }
  const rfpId = rfpIdFrom(fd)

  if (str(fd, 'intent') === 'preview') {
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) return { stage: 'error', message: 'Choose a file first' }
    if (file.size > MAX_LINE_FILE_BYTES) return { stage: 'error', message: 'That file is over 4 MB' }
    try {
      const sheet = await readSheet(file.name, new Uint8Array(await file.arrayBuffer()))
      return { stage: 'preview', plan: planLines(sheet), fileName: file.name }
    } catch (e) {
      if (e instanceof UnreadableFile) return { stage: 'error', message: e.message }
      throw e
    }
  }

  if (str(fd, 'intent') === 'commit') {
    // The preview's lines come back from the browser, so every one is
    // validated again with the same rules a hand-typed line meets. Nothing
    // here is taken on trust, and one bad line stops them all.
    let raw: unknown
    try {
      raw = JSON.parse(str(fd, 'lines'))
    } catch {
      return { stage: 'error', message: 'The preview could not be read. Upload the file again.' }
    }
    const list = committedLines.safeParse(raw)
    if (!list.success) return { stage: 'error', message: 'The preview could not be read. Upload the file again.' }
    const lines = []
    for (const item of list.data) {
      const p = lineInput.safeParse(item)
      if (!p.success) return { stage: 'error', message: 'A line failed validation, so nothing was added. Upload the file again.' }
      lines.push(p.data)
    }
    if (!(await getRfp(rfpId))) return { stage: 'error', message: 'RFP not found' }
    let added: number
    try {
      added = await addLines(rfpId, lines)
    } catch (e) {
      if (e instanceof RfpLocked) return { stage: 'error', message: e.message }
      throw e
    }
    revalidatePath(`/rfps/${rfpId}`)
    return { stage: 'done', added }
  }
  return { stage: 'idle' }
}

// --- Attachments -----------------------------------------------------------

export async function uploadAttachment(_prev: Errors, fd: FormData): Promise<Errors> {
  const who = await admin()
  if ('errors' in who) return who
  const rfpId = rfpIdFrom(fd)
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) return { errors: ['Choose a file first'] }
  if (file.size > MAX_ATTACHMENT_BYTES) return { errors: ['That file is over 4 MB'] }
  const name = file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || 'file'
  if (!isAllowedFile(name)) return { errors: [`.${extensionOf(name) || '?'} files cannot be attached`] }
  const rfp = await getRfp(rfpId)
  if (!rfp) return { errors: ['RFP not found'] }
  if (rfp.status !== 'draft') return { errors: [new RfpLocked().message] }

  const key = newStorageKey(rfpId)
  const contentType = file.type || 'application/octet-stream'
  await fileStore().put(key, new Uint8Array(await file.arrayBuffer()), contentType)
  try {
    await recordAttachment({ rfpId, name, storageKey: key, contentType, size: file.size, uploadedBy: who.id })
  } catch (e) {
    // No row, so no orphaned bytes either.
    await fileStore().delete(key).catch(() => {})
    throw e
  }
  revalidatePath(`/rfps/${rfpId}`)
  return { errors: [] }
}

export async function changeAttachmentVisibility(fd: FormData): Promise<void> {
  const who = await admin()
  if ('errors' in who) return
  const rfpId = rfpIdFrom(fd)
  await setAttachmentVisibility(rfpId, str(fd, 'attachmentId'), str(fd, 'visibility') === 'shared' ? 'shared' : 'internal')
  revalidatePath(`/rfps/${rfpId}`)
}

export async function removeAttachment(fd: FormData): Promise<void> {
  const who = await admin()
  if ('errors' in who) return
  const rfpId = rfpIdFrom(fd)
  const key = await deleteAttachment(rfpId, str(fd, 'attachmentId'))
  if (key) {
    // The row is gone, so nobody can reach the bytes; a failed delete leaves
    // an unreachable file rather than a broken page.
    await fileStore().delete(key).catch((e) => console.error('[attachments] could not delete stored file', e))
  }
  revalidatePath(`/rfps/${rfpId}`)
}

// --- Invites ---------------------------------------------------------------

/**
 * Where links in emails point. APP_URL when set, which is the right answer
 * behind anything that rewrites the host; otherwise this request's own
 * origin, which is correct on Vercel.
 */
async function siteOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export type SendState = { errors: string[]; result?: SendResult } | undefined

export async function sendInvitesAction(_prev: SendState, fd: FormData): Promise<SendState> {
  const who = await admin()
  if ('errors' in who) return who
  const rfpId = rfpIdFrom(fd)
  const supplierIds = fd.getAll('supplierId').map(String)
  if (supplierIds.length === 0) return { errors: ['Select at least one supplier'] }
  try {
    const result = await sendInvites({
      rfpId,
      supplierIds,
      allContacts: fd.get('allContacts') === 'on',
      staffId: who.id,
      origin: await siteOrigin(),
    })
    revalidatePath(`/rfps/${rfpId}`)
    return { errors: [], result }
  } catch (e) {
    return { errors: [(e as Error).message] }
  }
}

export async function revokeInviteAction(fd: FormData): Promise<void> {
  const who = await admin()
  if ('errors' in who) return
  const rfpId = rfpIdFrom(fd)
  await revokeInvite(rfpId, str(fd, 'inviteId'), who.id)
  revalidatePath(`/rfps/${rfpId}`)
}

export async function reissueLinkAction(fd: FormData): Promise<void> {
  const who = await admin()
  if ('errors' in who) return
  const rfpId = rfpIdFrom(fd)
  await reissueLink(rfpId, str(fd, 'linkId'), who.id, await siteOrigin())
  revalidatePath(`/rfps/${rfpId}`)
}
