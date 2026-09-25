'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { isAllowedAdminEmail, signIn } from '@/auth'

export async function requestSignInLink(_prev: string | undefined, formData: FormData) {
  const email = z
    .email()
    .safeParse(String(formData.get('email') ?? '').trim().toLowerCase())
  if (!email.success) return 'Enter a valid email address'

  // Unknown addresses get the same answer as known ones and no email, so the
  // form cannot be used to find out who has access.
  if (!(await isAllowedAdminEmail(email.data))) redirect('/login/check')

  // redirect: false, then our own redirect, so both branches land on the same
  // page. Left to Auth.js, a known address lands on its built-in
  // /api/auth/verify-request instead — a different URL, which would answer
  // the question the branch above refuses to.
  await signIn('resend', { email: email.data, redirectTo: '/suppliers', redirect: false })
  redirect('/login/check')
}

export async function signOutAction() {
  const { signOut } = await import('@/auth')
  await signOut({ redirectTo: '/login' })
}
