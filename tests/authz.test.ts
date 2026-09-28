import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Who the "current session" is, per test.
const session = vi.hoisted(() => ({ current: null as null | { user: Record<string, unknown> } }))
const signInSpy = vi.hoisted(() => vi.fn())

vi.mock('@/auth', async () => {
  const { eq } = await import('drizzle-orm')
  const { db } = await import('@/lib/db')
  const { users } = await import('@/lib/db/schema')
  return {
    auth: async () => session.current,
    signIn: signInSpy,
    signOut: vi.fn(),
    SIGN_IN_LINK_MINUTES: 15,
    // The real allowlist check, against the test database.
    isAllowedAdminEmail: async (email: string) =>
      Boolean(await db.query.users.findFirst({ where: eq(users.email, email) })),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { to })
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

import { db, pool } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { importAction, saveSupplier } from '@/app/(admin)/suppliers/actions'
import { requestSignInLink } from '@/app/login/actions'
import { listSuppliers } from '@/lib/suppliers/store'
import { resetDb } from './db'

const as = (role: 'admin' | 'viewer' | null) => {
  session.current = role ? { user: { id: 'u1', email: `${role}@team.example`, role } } : null
}

const supplierForm = () => {
  const fd = new FormData()
  fd.set(
    'payload',
    JSON.stringify({
      supplier: {
        company: 'Acme',
        category: 'UPS',
        region: '',
        status: 'active',
        contacts: [{ name: 'A', email: 'a@acme.example', isPrimary: true }],
      },
      contactIds: [null],
    }),
  )
  return fd
}

const importForm = () => {
  const fd = new FormData()
  fd.set('intent', 'commit')
  fd.set('text', 'company,category,contact_name,contact_email\nAcme,UPS,A,a@acme.example')
  return fd
}

beforeEach(async () => {
  await resetDb()
  signInSpy.mockReset()
})
afterAll(() => pool.end())

describe('server actions check the role themselves', () => {
  it('a viewer cannot save a supplier, and nothing is written', async () => {
    as('viewer')
    expect(await saveSupplier(undefined, supplierForm())).toEqual({
      errors: ['Only admins can edit suppliers'],
    })
    expect(await listSuppliers()).toHaveLength(0)
  })

  it('a viewer cannot import, and nothing is written', async () => {
    as('viewer')
    expect(await importAction({ stage: 'idle' }, importForm())).toMatchObject({ stage: 'error' })
    expect(await listSuppliers()).toHaveLength(0)
  })

  it('nobody signed in is sent to sign-in, and nothing is written', async () => {
    as(null)
    await expect(saveSupplier(undefined, supplierForm())).rejects.toMatchObject({ to: '/login' })
    await expect(importAction({ stage: 'idle' }, importForm())).rejects.toMatchObject({ to: '/login' })
    expect(await listSuppliers()).toHaveLength(0)
  })

  it('an admin can do both', async () => {
    as('admin')
    await expect(saveSupplier(undefined, supplierForm())).rejects.toMatchObject({ to: expect.stringMatching(/^\/suppliers\?saved=/) })
    expect(await importAction({ stage: 'idle' }, importForm())).toMatchObject({
      stage: 'done',
      result: { created: 0, skipped: 1 },
    })
  })

  it('the import commit re-validates on the server instead of trusting the preview', async () => {
    as('admin')
    const fd = new FormData()
    fd.set('intent', 'commit')
    fd.set('text', 'company,category,contact_name,contact_email\nAcme,UPS,A,not-an-email')
    expect(await importAction({ stage: 'idle' }, fd)).toMatchObject({ stage: 'error' })
    expect(await listSuppliers()).toHaveLength(0)
  })
})

describe('sign-in requests', () => {
  const form = (email: string) => {
    const fd = new FormData()
    fd.set('email', email)
    return fd
  }

  it('sends nothing to an address without access, and answers exactly as for one with it', async () => {
    await db.insert(users).values({ email: 'known@team.example', role: 'admin' })

    await expect(requestSignInLink(undefined, form('stranger@elsewhere.example'))).rejects.toMatchObject({
      to: '/login/check',
    })
    expect(signInSpy).not.toHaveBeenCalled()

    await expect(requestSignInLink(undefined, form('  Known@Team.example '))).rejects.toMatchObject({
      to: '/login/check',
    })
    expect(signInSpy).toHaveBeenCalledWith('resend', {
      email: 'known@team.example',
      redirectTo: '/rfps',
      redirect: false,
    })
  })
})

describe('structure', () => {
  // Every server action outside sign-in must call requireAdmin or
  // requireStaff. The next action will be written by someone who has not
  // read this, so the rule is checked rather than remembered.
  it('every server action checks the caller', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
      }
    }
    walk(path.resolve(__dirname, '../app'))
    const PUBLIC = [path.join('app', 'login', 'actions.ts')]

    const offenders: string[] = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      if (!/^['"]use server['"]/m.test(src)) continue
      if (PUBLIC.some((p) => file.endsWith(p))) continue
      // A local helper counts as a check only if it calls one itself.
      // Supplier-side actions resolve the portal link instead of a staff session.
      const guards = file.includes(`${path.sep}portal${path.sep}`) ? ['requirePortalAccess'] : ['requireAdmin', 'requireStaff']
      for (const m of src.matchAll(/^async function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/gm)) {
        if (/require(Admin|Staff)\(\)|requirePortalAccess\(/.test(m[2])) guards.push(m[1])
      }
      const guard = new RegExp(`\\b(${guards.join('|')})\\(`)
      const re = /export async function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g
      for (const m of src.matchAll(re)) {
        const head = m[2].slice(0, 300)
        if (!guard.test(head)) offenders.push(`${path.relative(process.cwd(), file)}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
