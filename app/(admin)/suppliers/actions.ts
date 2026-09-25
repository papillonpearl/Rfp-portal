'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { Forbidden, requireAdmin } from '@/lib/authz'
import { planCsvImport, type CsvPlan } from '@/lib/suppliers/csv'
import {
  createSupplier,
  DuplicateCompany,
  existingCompanyKeys,
  ConcurrentImport,
  importSuppliers,
  updateSupplier,
  type ImportResult,
} from '@/lib/suppliers/store'
import { issuesOf, supplierInput } from '@/lib/suppliers/validation'

// Server actions are public POST endpoints whatever the UI shows, so each one
// checks the caller's role itself. A viewer who crafts the request gets the
// same refusal as a viewer who never saw the button.

export type FormState = { errors: string[] } | undefined

const editPayload = z.object({
  id: z.uuid().optional(),
  supplier: z.unknown(),
  contactIds: z.array(z.uuid().nullable()),
})

export async function saveSupplier(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof Forbidden) return { errors: ['Only admins can edit suppliers'] }
    throw e
  }

  let raw: unknown
  try {
    raw = JSON.parse(String(formData.get('payload') ?? ''))
  } catch {
    return { errors: ['The form could not be read. Reload and try again.'] }
  }
  const envelope = editPayload.safeParse(raw)
  if (!envelope.success) return { errors: ['The form could not be read. Reload and try again.'] }

  const parsed = supplierInput.safeParse(envelope.data.supplier)
  if (!parsed.success) return { errors: issuesOf(parsed.error) }
  const input = parsed.data

  let id = envelope.data.id
  try {
    if (id) {
      await updateSupplier(id, {
        ...input,
        contacts: input.contacts.map((c, i) => ({
          ...c,
          id: envelope.data.contactIds[i] ?? undefined,
        })),
      })
    } else {
      id = await createSupplier(input)
    }
  } catch (e) {
    if (e instanceof DuplicateCompany) return { errors: [e.message] }
    throw e
  }
  revalidatePath('/suppliers')
  redirect(`/suppliers?saved=${encodeURIComponent(input.company)}`)
}

export type ImportState =
  | { stage: 'idle' }
  | { stage: 'preview'; plan: CsvPlan; text: string; fileName: string }
  | { stage: 'done'; result: ImportResult }
  | { stage: 'error'; message: string; plan?: CsvPlan; text?: string; fileName?: string }

export async function importAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof Forbidden) return { stage: 'error', message: 'Only admins can import suppliers' }
    throw e
  }

  const intent = formData.get('intent')
  if (intent === 'preview') {
    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return { stage: 'error', message: 'Choose a CSV file first' }
    }
    const text = await file.text()
    const plan = planCsvImport(text, await existingCompanyKeys())
    return { stage: 'preview', plan, text, fileName: file.name }
  }

  if (intent === 'commit') {
    // Re-planned from the text on the server. The preview the browser shows
    // is never what gets written.
    const text = String(formData.get('text') ?? '')
    const fileName = String(formData.get('fileName') ?? '')
    const plan = planCsvImport(text, await existingCompanyKeys())
    if (!plan.ok) {
      return {
        stage: 'error',
        message: 'The file has problems, so nothing was imported. Fix them and preview again.',
        plan,
        text,
        fileName,
      }
    }
    try {
      const result = await importSuppliers(plan)
      revalidatePath('/suppliers')
      return { stage: 'done', result }
    } catch (e) {
      if (e instanceof ConcurrentImport) return { stage: 'error', message: e.message }
      throw e
    }
  }

  return { stage: 'idle' }
}
