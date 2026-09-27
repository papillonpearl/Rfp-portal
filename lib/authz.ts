import 'server-only'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'

// Every admin page and every server action calls one of these itself.
// Nothing relies on a proxy or a layout alone: a server action is a public
// POST endpoint whether or not any page links to it.

export type Staff = { id: string; email: string; role: 'admin' | 'viewer' }

export class Forbidden extends Error {}

async function current(): Promise<Staff | null> {
  const session = await auth()
  const u = session?.user
  if (!u?.id || !u.email) return null
  return { id: u.id, email: u.email, role: u.role }
}

/** Any signed-in team member (admin or viewer). Pages redirect to sign-in. */
export async function requireStaff(): Promise<Staff> {
  const staff = await current()
  if (!staff) redirect('/login')
  return staff
}

/** Admins only. Viewers can read the directory, never change it. */
export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role !== 'admin') throw new Forbidden('Admin access required')
  return staff
}
