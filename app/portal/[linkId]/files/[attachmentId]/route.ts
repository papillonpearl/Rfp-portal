import { logActivity } from '@/lib/activity'
import { fileStore } from '@/lib/files/store'
import { requirePortalAccess } from '@/lib/portal/session'
import { sharedAttachmentForDownload } from '@/lib/rfps/supplier-safe'

// A supplier's download of a SHARED attachment on their own RFP. Lives under
// /portal/<linkId>/ so the link's path-scoped cookie reaches it.
export async function GET(_req: Request, ctx: RouteContext<'/portal/[linkId]/files/[attachmentId]'>) {
  const { linkId, attachmentId } = await ctx.params
  const access = await requirePortalAccess(linkId)
  if (!access) return new Response('This link is no longer valid.', { status: 404 })
  const file = await sharedAttachmentForDownload(access.rfpId, attachmentId)
  if (!file) return new Response('Not found', { status: 404 })
  const stream = await fileStore().get(file.storageKey)
  if (!stream) return new Response('Not found', { status: 404 })
  await logActivity({
    actor: { type: 'supplier', id: access.linkId },
    rfpId: access.rfpId,
    action: 'attachment.downloaded',
    detail: { inviteId: access.inviteId, attachmentId },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
}
