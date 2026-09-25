import Link from 'next/link'
import { requireStaff } from '@/lib/authz'
import { listSuppliers, supplierFacets } from '@/lib/suppliers/store'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function SuppliersPage(props: PageProps<'/suppliers'>) {
  const staff = await requireStaff()
  const sp = await props.searchParams
  const q = first(sp.q)
  const category = first(sp.category)
  const region = first(sp.region)
  const statusRaw = first(sp.status)
  const status = statusRaw === 'active' || statusRaw === 'inactive' ? statusRaw : undefined
  const saved = first(sp.saved)

  const [rows, facets] = await Promise.all([
    listSuppliers({ q, category, region, status }),
    supplierFacets(),
  ])
  const filtered = Boolean(q || category || region || status)
  const isAdmin = staff.role === 'admin'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Suppliers</h1>
        {isAdmin && (
          <>
            <Link href="/suppliers/import" className={buttonVariants({ variant: 'outline' })}>Import CSV</Link>
            <Link href="/suppliers/new" className={buttonVariants()}>Add supplier</Link>
          </>
        )}
      </div>

      {saved && (
        <p className="rounded-md border bg-muted p-3 text-sm">Saved {saved}.</p>
      )}

      {/* A plain GET form: filters live in the URL, so a filtered view can be
          bookmarked or sent to a colleague, and it works without JavaScript. */}
      <form className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" method="get">
        <Input name="q" defaultValue={q} placeholder="Search company or contact" aria-label="Search" />
        <NativeSelect name="category" defaultValue={category} aria-label="Category">
          <option value="">All categories</option>
          {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
        <NativeSelect name="region" defaultValue={region} aria-label="Region">
          <option value="">All regions</option>
          {facets.regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={statusRaw} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">Filter</Button>
          {filtered && <Link href="/suppliers" className={buttonVariants({ variant: 'ghost' })}>Clear</Link>}
        </div>
      </form>

      <p className="text-sm text-muted-foreground">
        {rows.length} supplier{rows.length === 1 ? '' : 's'}{filtered ? ' match' : ''}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Primary contact</TableHead>
            <TableHead className="text-right">Contacts</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                {filtered ? 'No suppliers match these filters.' : 'No suppliers yet.'}
              </TableCell>
            </TableRow>
          )}
          {rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">
                {isAdmin ? (
                  <Link href={`/suppliers/${s.id}`} className="hover:underline">{s.company}</Link>
                ) : (
                  s.company
                )}
              </TableCell>
              <TableCell>{s.category}</TableCell>
              <TableCell>{s.region ?? '—'}</TableCell>
              <TableCell>
                {s.primaryName ? (
                  <div className="flex flex-col">
                    <span>{s.primaryName}</span>
                    <span className="text-xs text-muted-foreground">{s.primaryEmail}</span>
                  </div>
                ) : (
                  <span className="text-destructive">None</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{s.contactCount}</TableCell>
              <TableCell>
                <Badge variant={s.status === 'active' ? 'secondary' : 'outline'}>{s.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
