import { createHash, randomBytes } from 'node:crypto'

// A portal link's secret. 32 random bytes; only the SHA-256 is stored, so a
// copy of the database opens nothing. SHA-256 without a salt is right here:
// the input is 256 bits of randomness, not a password anyone could guess.

export function newPortalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashPortalToken(token) }
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const PORTAL_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/** The cookie holding one link's token, readable only by that link's pages. */
export const portalCookieName = (linkId: string) => `rfp_portal_${linkId}`
export const portalPath = (linkId: string) => `/portal/${linkId}`
