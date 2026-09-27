import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export async function resetDb() {
  await db.execute(
    sql`truncate table supplier_contacts, suppliers, sessions, accounts, verification_tokens, users restart identity cascade`,
  )
}
