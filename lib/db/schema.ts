import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Internal team. Auth.js reads and writes `users`, `sessions` and
// `verification_tokens` through its adapter; `accounts` exists only because
// the adapter requires it (it would hold OAuth links if Google login is added).
//
// Nobody can create a user by signing in. The signIn callback in `auth.ts`
// refuses any address not already in this table, so the adapter's createUser
// is never reached. Users are added with `npm run user:add`.
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['admin', 'viewer'])

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { mode: 'date', withTimezone: true }),
  image: text('image'),
  role: userRole('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

// ---------------------------------------------------------------------------
// Supplier directory.
// ---------------------------------------------------------------------------

export const supplierStatus = pgEnum('supplier_status', ['active', 'inactive'])

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    company: text('company').notNull(),
    // Free text, not an enum: "UPS", "batteries", "chillers" today, and a new
    // category should not need a migration. The filter lists what exists.
    category: text('category').notNull(),
    region: text('region'),
    status: supplierStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per company, compared case- and space-insensitively, so a CSV
    // import cannot create "Acme Power" beside "acme power ".
    uniqueIndex('suppliers_company_key').on(sql`lower(btrim(${t.company}))`),
    index('suppliers_category_idx').on(t.category),
  ],
)

export const supplierContacts = pgTable(
  'supplier_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    uniqueIndex('supplier_contacts_email_key').on(t.supplierId, sql`lower(${t.email})`),
    // At most one primary per supplier, enforced by the database rather than
    // hoped for in a form. "At least one" is enforced in validation, since a
    // constraint cannot express it.
    uniqueIndex('supplier_contacts_one_primary')
      .on(t.supplierId)
      .where(sql`${t.isPrimary}`),
  ],
)

export type Supplier = typeof suppliers.$inferSelect
export type SupplierContact = typeof supplierContacts.$inferSelect
export type User = typeof users.$inferSelect
