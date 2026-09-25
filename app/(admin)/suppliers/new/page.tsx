import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/authz'
import { supplierFacets } from '@/lib/suppliers/store'
import { SupplierForm } from '@/components/suppliers/supplier-form'

export default async function NewSupplierPage() {
  const staff = await requireStaff()
  if (staff.role !== 'admin') redirect('/suppliers')
  const { categories } = await supplierFacets()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Add supplier</h1>
      <SupplierForm categories={categories} />
    </div>
  )
}
