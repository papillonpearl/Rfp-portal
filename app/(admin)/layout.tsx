import Link from 'next/link'
import { requireStaff } from '@/lib/authz'
import { Button } from '@/components/ui/button'
import { signOutAction } from '@/app/login/actions'

export default async function AdminLayout({ children }: LayoutProps<'/'>) {
  // Gate for rendering only. Every action re-checks for itself.
  const staff = await requireStaff()
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/rfps" className="font-semibold">Supplier RFP Portal</Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/rfps" className="hover:underline">RFPs</Link>
            <Link href="/suppliers" className="hover:underline">Suppliers</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            <span className="truncate">{staff.email} · {staff.role}</span>
            <form action={signOutAction}>
              <Button variant="outline" size="sm" type="submit">Sign out</Button>
            </form>
          </div>
        </div>
      </header>
      <div className="border-b bg-warning/15 px-4 py-1.5 text-center text-xs">
        Test data only. No real supplier pricing, site data or budget figures until hosting is approved.
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </>
  )
}
