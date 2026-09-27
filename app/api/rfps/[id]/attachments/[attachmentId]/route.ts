import { auth } from '@/auth'
import { fileStore } from '@/lib/files/store'
import { getAttachment } from '@/lib/rfps/store'

// Admin download of any attachment, internal or shared. Suppliers get their
// own route from Phase 3, reading through sharedAttachmentForDownload().

export async function GET(_req: Request, ctx: RouteContext<'/api/rfps/[id]/attachments/[attachmentId]'>) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Sign in required', { status: 401 })

  const { id, attachmentId } = await ctx.params
  const file = await getAttachment(id, attachmentId)
  if (!file) return new Response('Not found', { status: 404 })
  const stream = await fileStore().get(file.storageKey)
  if (!stream) return new Response('File missing from storage', { status: 404 })

  return new Response(stream, {
    headers: {
      // Always a download, never rendered: an uploaded file must not be able
      // to run as a page on this site's origin.
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
}
