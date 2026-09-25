import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { getSupplier, supplierFacets } from '@/lib/suppliers/store'
import { SupplierForm } from '@/components/suppliers/supplier-form'

export default async function EditSupplierPage(props: PageProps<'/suppliers/[id]'>) {
  const staff = await requireStaff()
  if (staff.role !== 'admin') redirect('/suppliers')
  const { id } = await props.params
  const [supplier, { categories }] = await Promise.all([getSupplier(id), supplierFacets()])
  if (!supplier) notFound()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit {supplier.company}</h1>
      <SupplierForm
        categories={categories}
        initial={{
          id: supplier.id,
          company: supplier.company,
          category: supplier.category,
          region: supplier.region ?? '',
          status: supplier.status,
          contacts: supplier.contacts.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            isPrimary: c.isPrimary,
          })),
        }}
      />
    </div>
  )
}
