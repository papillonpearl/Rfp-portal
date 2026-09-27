import { z } from 'zod'

// One definition of a valid RFP and a valid line, used by the builder's forms
// and by the spreadsheet upload alike.

const text = (label: string, max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, `${label} is required`).max(max, `${label} is too long`))

const optionalText = (label: string, max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s ?? '').trim())
    .pipe(z.string().max(max, `${label} is too long`))

/**
 * A decimal written by a person: "1,200", "$1,200.50", " 3 ". Returns the
 * canonical string ("1200", "1200.5") or undefined. Deliberately strict —
 * no exponents, no negatives, no units — because a quantity that parsed
 * loosely is a quantity somebody did not mean.
 */
export function parseDecimal(raw: unknown, maxDecimals: number): string | undefined {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return undefined
    raw = String(raw)
  }
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().replace(/^\$/, '').replace(/,(?=\d{3}(\D|$))/g, '').trim()
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(s)
  if (!m) return undefined
  const frac = (m[2] ?? '').replace(/0+$/, '')
  if (frac.length > maxDecimals) return undefined
  const whole = m[1].replace(/^0+(?=\d)/, '')
  return frac ? `${whole}.${frac}` : whole
}

const decimal = (label: string, maxDecimals: number, opts: { positive?: boolean } = {}) =>
  z.unknown().transform((v, ctx) => {
    const d = parseDecimal(v, maxDecimals)
    if (d === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} must be a number${maxDecimals ? ` with at most ${maxDecimals} decimal places` : ''}`,
      })
      return z.NEVER
    }
    if (opts.positive && Number(d) === 0) {
      ctx.addIssue({ code: 'custom', message: `${label} must be more than zero` })
      return z.NEVER
    }
    return d
  })

export const visibilityInput = z.enum(['internal', 'shared'])

export const lineInput = z.object({
  site: optionalText('Site', 120).transform((s) => (s === '' ? null : s)),
  equipment: text('Equipment', 200),
  spec: optionalText('Spec', 4000),
  qty: decimal('Quantity', 3, { positive: true }),
  unit: text('Unit', 30),
  visibility: visibilityInput.default('internal'),
  internalEstimate: z
    .unknown()
    .transform((v, ctx) => {
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null
      const d = parseDecimal(v, 2)
      if (d === undefined) {
        ctx.addIssue({ code: 'custom', message: 'Internal estimate must be an amount like 1200 or 1,200.50' })
        return z.NEVER
      }
      return d
    }),
})
export type LineInput = z.output<typeof lineInput>

export const rfpInput = z.object({
  title: text('Title', 200),
  type: z.enum(['RFP', 'RFQ']),
  description: optionalText('Description', 20_000),
  internalNotes: optionalText('Internal notes', 20_000),
  // An ISO instant produced in the browser from the admin's local time, so
  // the stored due date is the moment they meant, in any time zone.
  dueAt: z
    .string()
    .nullish()
    .transform((s, ctx) => {
      if (!s) return null
      const d = new Date(s)
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'Due date is not a valid date' })
        return z.NEVER
      }
      return d
    }),
  sealed: z.boolean(),
})
export type RfpInput = z.output<typeof rfpInput>
