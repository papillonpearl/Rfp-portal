import { NextResponse } from 'next/server'
import { enterPortal } from '@/lib/portal/access'
import { portalCookieName, portalPath } from '@/lib/portal/tokens'

// Swap an emailed token for a cookie. POST with the token in the body, so it
// never appears in a URL, a server log or a Referer header.
export async function POST(req: Request) {
  let token: unknown
  try {
    token = ((await req.json()) as { token?: unknown }).token
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const access = typeof token === 'string' ? await enterPortal(token) : null
  // One answer for revoked, expired, unknown and malformed alike.
  if (!access) return NextResponse.json({ ok: false }, { status: 404 })

  const res = NextResponse.json({ ok: true, path: portalPath(access.linkId) })
  res.cookies.set(portalCookieName(access.linkId), token as string, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Sent only to this link's pages and downloads, never anywhere else.
    path: portalPath(access.linkId),
    maxAge: 60 * 60 * 24 * 90,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
