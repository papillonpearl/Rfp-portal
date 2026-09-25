import NextAuth from 'next-auth'
import Resend from 'next-auth/providers/resend'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts, sessions, users, verificationTokens } from '@/lib/db/schema'
import { sendMail } from '@/lib/email'

// Admin sign-in: an emailed magic link, internal team only.
//
// Supplier access is a different mechanism entirely (per-RFP portal links,
// Phase 3) and never goes through this file. A supplier holding a session
// here would be a supplier inside the admin app.

export const SIGN_IN_LINK_MINUTES = 15

export async function isAllowedAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const row = await db.query.users.findFirst({
    where: eq(users.email, email.trim().toLowerCase()),
    columns: { id: true },
  })
  return Boolean(row)
}

/**
 * The emailed link points at our own confirmation page, not at Auth.js's
 * callback. The callback is a GET that spends the token, and corporate mail
 * scanners (Microsoft Defender Safe Links among them) fetch every link in an
 * inbound message — so a direct link is used up by the scanner before the
 * person clicks it, and sign-in "fails" for no visible reason. The
 * confirmation page spends nothing; its button does.
 *
 * The parameters ride in the fragment (after #), which browsers never send to
 * a server. In the query string, a live token would land in every request log
 * — Vercel's included — for fifteen minutes of usefulness. It reaches a log
 * only on the callback, by which point it is spent.
 */
export function confirmationUrl(callbackUrl: string): string {
  const cb = new URL(callbackUrl)
  return `${cb.origin}/login/confirm#${cb.searchParams.toString()}`
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database', maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: '/login', verifyRequest: '/login/check', error: '/login' },
  providers: [
    Resend({
      maxAge: SIGN_IN_LINK_MINUTES * 60,
      async sendVerificationRequest({ identifier, url }) {
        const link = confirmationUrl(url)
        await sendMail({
          to: identifier,
          subject: 'Your sign-in link — Supplier RFP Portal',
          text: `Sign in to the Supplier RFP Portal:\n\n${link}\n\nThe link works once and expires in ${SIGN_IN_LINK_MINUTES} minutes. If you did not ask for it, ignore this email.`,
          html: `<p>Sign in to the Supplier RFP Portal:</p><p><a href="${link}">Continue to sign in</a></p><p>The link works once and expires in ${SIGN_IN_LINK_MINUTES} minutes. If you did not ask for it, ignore this email.</p>`,
        })
      },
    }),
  ],
  callbacks: {
    // Called when the link is requested AND when it is redeemed. Refusing an
    // unknown address here means no email is sent and no user row is ever
    // created by signing in — the adapter's createUser is never reached.
    async signIn({ user }) {
      return isAllowedAdminEmail(user.email)
    },
    async session({ session, user }) {
      const role = (user as { role?: 'admin' | 'viewer' }).role ?? 'viewer'
      return { ...session, user: { ...session.user, id: user.id, role } }
    },
  },
})
