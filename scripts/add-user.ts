import 'dotenv/config'
import { z } from 'zod'
import { db, pool } from '../lib/db'
import { users } from '../lib/db/schema'

// The only way anyone gets into the admin app. Sign-in refuses any address
// not in `users`, so this is the access list.
//
//   npm run user:add -- someone@company.com admin
//   npm run user:add -- someone@company.com viewer

async function main() {
  const [emailArg, roleArg = 'viewer'] = process.argv.slice(2)
  const email = z.email().safeParse(emailArg?.trim().toLowerCase())
  const role = z.enum(['admin', 'viewer']).safeParse(roleArg)
  if (!email.success || !role.success) {
    console.error('Usage: npm run user:add -- <email> [admin|viewer]')
    process.exit(2)
  }
  await db
    .insert(users)
    .values({ email: email.data, role: role.data })
    .onConflictDoUpdate({ target: users.email, set: { role: role.data } })
  console.log(`${email.data} is now ${role.data}.`)
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e)
    await pool.end()
    process.exit(1)
  })
