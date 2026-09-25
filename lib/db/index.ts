import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// One pool per server instance. In development, module reloads would
// otherwise open a new pool on every edit and exhaust connections.
const globalForDb = globalThis as unknown as { pool?: Pool }

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See .env.example.')
  }
  return new Pool({ connectionString, max: 5 })
}

export const pool = globalForDb.pool ?? makePool()
if (process.env.NODE_ENV !== 'production') globalForDb.pool = pool

export const db = drizzle(pool, { schema })
export type Db = typeof db
export { schema }
