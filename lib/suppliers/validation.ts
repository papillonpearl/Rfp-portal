import { z } from 'zod'

// One set of rules for a supplier, used by the add/edit form and by the CSV
// import alike. Two copies of "what a valid supplier is" would drift, and the
// import is where a bad row arrives in bulk.

const trimmed = (label: string, max: number) =>
  z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(1, `${label} is required`).max(max, `${label} is too long`))

const optionalTrimmed = (max: number) =>
  z
    .string()
    .optional()
    .transform((s) => {
      const t = (s ?? '').trim().replace(/\s+/g, ' ')
      return t === '' ? null : t
    })
    .pipe(z.string().max(max).nullable())

export const contactInput = z.object({
  name: trimmed('Contact name', 120),
  email: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.email('Contact email is not a valid address')),
  isPrimary: z.boolean(),
})

export const supplierInput = z
  .object({
    company: trimmed('Company', 200),
    category: trimmed('Category', 80),
    region: optionalTrimmed(80),
    status: z.enum(['active', 'inactive']),
    contacts: z.array(contactInput).min(1, 'Add at least one contact'),
  })
  .superRefine((s, ctx) => {
    // Invites go to the primary contact, so a supplier without exactly one
    // is a supplier that cannot be invited. The database refuses two; only
    // validation can refuse none.
    const primaries = s.contacts.filter((c) => c.isPrimary).length
    if (primaries !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['contacts'],
        message:
          primaries === 0
            ? 'Mark one contact as primary'
            : 'Only one contact can be primary',
      })
    }
    const seen = new Set<string>()
    for (const c of s.contacts) {
      if (seen.has(c.email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contacts'],
          message: `${c.email} is listed twice`,
        })
      }
      seen.add(c.email)
    }
  })

export type SupplierInput = z.output<typeof supplierInput>

/** Case- and space-insensitive company key, matching the database's unique index. */
export function companyKey(company: string): string {
  return company.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** First message per field, flattened for display. */
export function issuesOf(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => i.message))]
}
