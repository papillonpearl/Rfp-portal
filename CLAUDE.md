@AGENTS.md

# Supplier RFP Portal — project context

Admin team runs RFPs/RFQs; suppliers respond through per-RFP links. Built in
six phases from "Supplier RFP Portal — Build Spec" (25 Sep 2026). **Phase 1
is done**: admin sign-in, supplier directory, CSV import.

**Test data only** until DLR security approves hosting. Seeded suppliers are
invented and use `example.com` addresses, which is reserved and receives no
mail, so a test invite can't reach a real company.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, Postgres via **Drizzle**,
Auth.js v5 (email magic link, database sessions), Resend over plain `fetch`.

- **Drizzle, not Prisma.** The spec allows either. Prisma 7's CLI carries four
  high-severity advisories with no fix; Drizzle's production dependencies
  audit clean. On a tool whose whole point is keeping data isolated, that
  decided it.
- **shadcn/ui components are hand-written** in `components/ui/`, in shadcn's
  style and with its tokens, because the registry was unreachable from the
  build environment. `components.json` is present, so `npx shadcn add` works
  alongside them.
- Next 16 has breaking changes: `params`/`searchParams` are Promises, and
  `middleware` is now `proxy`. **Read `node_modules/next/dist/docs/`** before
  relying on memory.

## Security rules (from the spec; they apply to every phase)

Supplier isolation must never fail. Filter on the server; never rely on
hiding things in the UI. `internal` is the default visibility. Links are
scoped, expiring and revocable. Nothing that signals other suppliers leaks
across. Every supplier read and write is logged.

What Phase 1 already enforces:

- **Every server action checks the caller's role itself** (`requireAdmin` /
  `requireStaff` in `lib/authz.ts`). A server action is a public POST
  endpoint whether or not a page links to it, so the layout's check is for
  rendering only. `tests/authz.test.ts` scans every `'use server'` file and
  fails if an exported action skips the check. Only `app/login/actions.ts` is
  exempt, because it is public by design.
- **Sign-in is an allowlist.** The `signIn` callback refuses any address
  missing from `users`, so no user row is ever created by signing in. An
  unknown address gets the same page as a known one and no email.
  `signIn(..., { redirect: false })` followed by our own redirect exists for
  this reason: left to Auth.js, a known address lands on
  `/api/auth/verify-request`, a different URL, which would give the answer
  away.
- **The emailed link goes to `/login/confirm`, not to the callback.** The
  callback is a GET that spends the token, and corporate mail scanners
  (Defender Safe Links) fetch every link. The confirm page spends nothing;
  its button does. **The token rides in the URL fragment**, which never
  reaches a server, so an unspent token is in no request log. Vercel logs
  query strings.
- **A contact id from another supplier is never honoured** in an edit. It is
  treated as a new contact. Tested.
- **Suppliers are never deleted.** Set them to inactive. From Phase 3,
  invites, bids and the log point at suppliers.

## Data rules worth not re-deriving

- One supplier per company, **case- and space-insensitive**: a unique index on
  `lower(btrim(company))`, and the validator collapses internal spaces.
- **Exactly one primary contact.** A partial unique index refuses two; only
  validation can refuse none. Invites go to the primary.
- **Contacts are edited in place by id**, never deleted and recreated: later
  phases hang invites and log entries off them. Moving the primary clears
  every flag first, because the index is checked per statement.
- **Correlated subqueries name `"suppliers"."id"` explicitly.** Interpolating
  `${suppliers.id}` renders a bare `"id"` in a select list, which inside the
  subquery resolves to the contact's id. The list showed no primary and zero
  contacts for everyone until a test caught it.
- **CSV import** (`lib/suppliers/csv.ts`): one row per contact, grouped by
  company. It is planned twice, once for the preview and again on the server
  at commit, so what gets written is never taken from the browser. **All or
  nothing:** one bad row and nothing is written. A company already in the
  directory is **skipped, never updated**. Rows for one company that disagree
  on category, region or status are refused rather than guessed. A lone
  contact with no primary marked becomes primary; several with none are
  refused.

## Changes to the spec's data model for later phases

Agreed before Phase 1; build them when the phase arrives:

- `invites`: add `expires_at`, `revoked_at`; store **`token_hash`**, never the
  token.
- **One link per contact**, not per supplier, so the log can say which person
  acted, grouped under the supplier's invite.
- A **per-round submission record** (supplier, round, submitted_at), so
  "confirmed unchanged" and "never replied" differ. Without it the stale flag
  can't tell them apart.
- `attachments.update_id`, so an addendum's files belong to the update and
  only its recipients see them.
- `questions`: a separate **broadcast text** that the admin can edit, because
  removing the name doesn't anonymise "our Model X…".
- **Sealed bids are sealed in the application, not cryptographically.**
  Database access still reveals them. Say so to DLR security, or encrypt
  amounts until `due_at`.
- **Excel export**: prefix any cell starting with `= + - @` with `'`. A
  supplier-entered note is otherwise a formula in the admin's spreadsheet.

## Email and hosting

`EMAIL_FROM` must be on a domain verified **for this project**. Never
`papillonpearl.com`: DLR procurement mail must not go out under Charlotte's
practice's name. Give it its own Vercel project and Neon database, not the PPL
ones, so moving it once security approves is a transfer, not an untangling.

## Testing

`npm test` runs against a real Postgres (`TEST_DATABASE_URL`, which it
truncates). Also run `npm run lint`, `npm run typecheck` and `npm run build`.
Check pages at **390px** for horizontal overflow; wide tables scroll inside
their own container.
