import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
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

// ---------------------------------------------------------------------------
// RFPs, their line items and attachments.
//
// VISIBILITY. Every line and attachment is `internal` or `shared`, and the
// default is `internal`: a row nobody decided about stays with the team.
// Some fields are internal by kind and carry no toggle at all — an RFP's
// `internal_notes`, a line's `internal_estimate`. Suppliers never read these
// tables directly; they get `getSupplierSafeRfp()` (lib/rfps/supplier-safe.ts),
// which selects shared fields by name rather than stripping internal ones.
// ---------------------------------------------------------------------------

export const visibility = pgEnum('visibility', ['internal', 'shared'])
export const rfpType = pgEnum('rfp_type', ['RFP', 'RFQ'])
export const rfpStatus = pgEnum('rfp_status', ['draft', 'open', 'closed', 'awarded'])

export const rfps = pgTable('rfps', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  type: rfpType('type').notNull().default('RFP'),
  status: rfpStatus('status').notNull().default('draft'),
  /** Shared: what suppliers read as the RFP's introduction. */
  description: text('description').notNull().default(''),
  /** Internal by kind: budget context, strategy, anything for the team only. */
  internalNotes: text('internal_notes').notNull().default(''),
  dueAt: timestamp('due_at', { mode: 'date', withTimezone: true }),
  // Sealed by default, changeable per RFP (open decision #4 in the spec).
  sealed: boolean('sealed').notNull().default(true),
  currentRound: integer('current_round').notNull().default(1),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})

export const lineItems = pgTable(
  'line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rfpId: uuid('rfp_id')
      .notNull()
      .references(() => rfps.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    // Site is optional: the 2027 battery RFQ is site-by-site, a generic RFQ
    // is not (open decision #5).
    site: text('site'),
    equipment: text('equipment').notNull(),
    spec: text('spec').notNull().default(''),
    // numeric, not float: quantities and money must add up exactly. Drizzle
    // returns numeric as a string, which keeps it exact until display.
    qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    visibility: visibility('visibility').notNull().default('internal'),
    /** Internal by kind: the team's expected unit price. Never shown to a supplier. */
    internalEstimate: numeric('internal_estimate', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('line_items_rfp_idx').on(t.rfpId, t.position)],
)

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rfpId: uuid('rfp_id')
      .notNull()
      .references(() => rfps.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // A private storage key, never a public URL. Files are served through
    // routes that check who is asking; a public URL would be readable by
    // anyone it reached, whatever the visibility column said.
    storageKey: text('storage_key').notNull().unique(),
    contentType: text('content_type').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    visibility: visibility('visibility').notNull().default('internal'),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attachments_rfp_idx').on(t.rfpId)],
)

export type Rfp = typeof rfps.$inferSelect
export type LineItem = typeof lineItems.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type Supplier = typeof suppliers.$inferSelect
export type SupplierContact = typeof supplierContacts.$inferSelect
export type User = typeof users.$inferSelect
