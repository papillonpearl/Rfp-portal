import Link from 'next/link'
import { SIGN_IN_LINK_MINUTES } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function CheckEmailPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If that address has access, a sign-in link is on its way. It works once and expires in{' '}
            {SIGN_IN_LINK_MINUTES} minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm underline underline-offset-4">
            Use a different address
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
