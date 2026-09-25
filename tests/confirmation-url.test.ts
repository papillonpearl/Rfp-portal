import { describe, expect, it, vi } from 'vitest'

vi.mock('next-auth', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }))

import { confirmationUrl } from '@/auth'

describe('confirmationUrl', () => {
  const callback =
    'https://rfp.example.com/api/auth/callback/resend?callbackUrl=https%3A%2F%2Frfp.example.com%2Fsuppliers&token=abc123&email=a%40b.example'

  it('points at our confirmation page, not the token-spending callback', () => {
    const url = new URL(confirmationUrl(callback))
    expect(url.origin + url.pathname).toBe('https://rfp.example.com/login/confirm')
  })

  it('carries the token only in the fragment, which never reaches a server log', () => {
    const url = new URL(confirmationUrl(callback))
    expect(url.search).toBe('')
    const fragment = new URLSearchParams(url.hash.slice(1))
    expect(fragment.get('token')).toBe('abc123')
    expect(fragment.get('email')).toBe('a@b.example')
    expect(fragment.get('callbackUrl')).toBe('https://rfp.example.com/suppliers')
  })
})
