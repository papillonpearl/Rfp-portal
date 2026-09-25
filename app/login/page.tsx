import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from './login-form'

export default async function LoginPage(props: PageProps<'/login'>) {
  const session = await auth()
  if (session?.user) redirect('/suppliers')
  const { error } = await props.searchParams

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Supplier RFP Portal</CardTitle>
          <CardDescription>Internal team sign-in. No password — we email you a link.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            // Every failure reads the same: expired, already used, or refused.
            // Telling them apart helps nobody who just needs a fresh link.
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              That sign-in link did not work. It may have expired or already been used — request a new one.
            </p>
          )}
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  )
}
