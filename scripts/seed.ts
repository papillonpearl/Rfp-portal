import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db'
import { supplierContacts, suppliers, users } from '../lib/db/schema'

// Ten invented suppliers. Every name is fictional and every address is on
// example.com, a domain reserved so that mail to it goes nowhere — so a test
// invite in Phase 3 cannot reach a real company by accident.
//
// Re-running is safe: existing companies are left alone.

const SUPPLIERS = [
  ['Northwind Power Systems', 'UPS', 'Northeast', [['Avery Lang', 'avery'], ['Blake Moreno', 'blake']]],
  ['Contoso Critical Power', 'UPS', 'Southeast', [['Casey Ngata', 'casey']]],
  ['Fabrikam UPS Solutions', 'UPS', 'West', [['Devon Price', 'devon'], ['Emery Kade', 'emery']]],
  ['Tailspin Backup Power', 'UPS', 'Midwest', [['Finley Osei', 'finley']]],
  ['Litware Battery Co.', 'Batteries', 'Midwest', [['Gray Lindqvist', 'gray'], ['Harper Bell', 'harper']]],
  ['Adatum Energy Storage', 'Batteries', 'West', [['Indigo Reyes', 'indigo']]],
  ['Proseware Cells', 'Batteries', 'Northeast', [['Jules Varga', 'jules']]],
  ['Coho Chiller Works', 'Chillers', 'Southeast', [['Kai Andersen', 'kai'], ['Lane Obi', 'lane']]],
  ['Wingtip Thermal', 'Chillers', 'West', [['Morgan Hale', 'morgan']]],
  ['Relecloud Cooling', 'Chillers', 'Midwest', [['Noel Park', 'noel'], ['Oakley Ruiz', 'oakley'], ['Parker Wynn', 'parker']]],
] as const

function slug(company: string) {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function main() {
  let created = 0
  for (const [company, category, region, contacts] of SUPPLIERS) {
    const exists = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(sql`lower(btrim(${suppliers.company})) = lower(${company})`)
    if (exists.length) continue
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(suppliers).values({ company, category, region }).returning({ id: suppliers.id })
      await tx.insert(supplierContacts).values(
        contacts.map(([name, local], i) => ({
          supplierId: row.id,
          name,
          email: `${local}@${slug(company)}.example.com`,
          isPrimary: i === 0,
        })),
      )
    })
    created++
  }
  console.log(`Seeded ${created} supplier(s); ${SUPPLIERS.length - created} already present.`)

  const admin = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  if (admin) {
    await db
      .insert(users)
      .values({ email: admin, role: 'admin' })
      .onConflictDoUpdate({ target: users.email, set: { role: 'admin' } })
    console.log(`Admin ensured: ${admin}`)
  } else {
    console.log('SEED_ADMIN_EMAIL not set; no admin created. Use `npm run user:add -- <email> admin`.')
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e)
    await pool.end()
    process.exit(1)
  })
