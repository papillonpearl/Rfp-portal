import 'server-only'
import { cookies } from 'next/headers'
import { portalAccess, type PortalAccess } from './access'
import { portalCookieName } from './tokens'

/**
 * The supplier-side equivalent of requireStaff(): every portal page, action
 * and download calls this first. The link id comes from the URL; the token
 * comes only from that link's httpOnly cookie, which page scripts cannot
 * read and which is sent only to that link's own paths.
 */
export async function requirePortalAccess(linkId: string): Promise<PortalAccess | null> {
  const jar = await cookies()
  return portalAccess(linkId, jar.get(portalCookieName(linkId))?.value)
}
