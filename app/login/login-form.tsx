'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { requestSignInLink } from './actions'

export function LoginForm() {
  const [error, action, pending] = useActionState(requestSignInLink, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <Label htmlFor="email">Work email</Label>
      <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </form>
  )
}
