'use client'

import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function ConfirmForm() {
  // Empty on the server, the fragment in the browser.
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => null)
  if (hash === null) return null

  const params = new URLSearchParams(hash)
  const token = params.get('token') ?? ''
  const email = params.get('email') ?? ''
  const callbackUrl = params.get('callbackUrl') ?? ''
  const complete = Boolean(token && email)

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {complete ? <>Continue as <strong>{email}</strong>.</> : 'This link is incomplete — request a new one.'}
        </CardDescription>
      </CardHeader>
      {complete && (
        <CardContent>
          <form method="get" action="/api/auth/callback/resend">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="email" value={email} />
            {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
            <Button type="submit" className="w-full">Sign in</Button>
          </form>
        </CardContent>
      )}
    </Card>
  )
}
