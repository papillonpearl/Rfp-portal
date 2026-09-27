@AGENTS.md

# Supplier RFP Portal — project context

Admin team runs RFPs/RFQs; suppliers respond through per-RFP links. Built in
six phases from "Supplier RFP Portal — Build Spec" (25 Sep 2026). **Phases 1
and 2 are done**: admin sign-in, supplier directory and CSV import; the RFP
builder, line items (by hand or from Excel), attachments and visibility.

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

## The RFP builder (Phase 2)

- **`getSupplierSafeRfp()` (`lib/rfps/supplier-safe.ts`) is the only way
  supplier-facing code reads an RFP.** It *selects* shared fields by name and
  never loads a row and strips it. A new column stays internal until someone
  adds it there on purpose. Three tests hold it:
  - a sentinel string is planted in every internal field and must not appear
    in the output;
  - the returned keys must match exactly;
  - every column of `rfps`, `line_items` and `attachments` must be classified
    shared or internal, so adding a column fails the test until someone
    decides.

  A fourth test refuses any file under `app/portal` or `app/api/portal` that
  imports `@/lib/db` or `@/lib/rfps/store`. It is in place before the first
  portal file exists.
- **The admin "Preview as supplier" page renders that function's output**
  through `SupplierView`, whose only input is the supplier-safe type. The
  preview is what a supplier receives, not a mock-up of it. Phase 3's portal
  should render the same component. It numbers lines 1..n as the supplier
  sees them, so gaps left by internal lines don't hint at anything.
- **Visibility defaults to internal** for lines and attachments, including
  uploaded ones. Two fields are internal by kind and have no toggle:
  `rfps.internal_notes` and `line_items.internal_estimate`. The RFP's
  `description` is what suppliers read.
- **Every line or attachment write is scoped by its id AND the RFP's id**, so
  a forged id from another RFP matches nothing. Tested for each write.
- **Quantities and money are `numeric`,** which Drizzle returns as strings.
  `parseDecimal` accepts "1,200" and "$1,200.50". It refuses exponents,
  negatives, units and surplus decimals, because a loosely parsed quantity is
  one somebody didn't mean. The builder's estimate total uses floats and is
  for display only; **Phase 5 totals must be exact.**
- **Line upload** (`lib/rfps/line-sheet.ts`): .xlsx through **exceljs** (the
  SheetJS CDN was unreachable, and npm's `xlsx` is an unpatched 0.18.5), or
  .csv. Only the first sheet is read, and the note says so. A formula is read
  as its saved result, which is what the person saw. An Excel error cell
  (`#REF!`) is named by row, never imported as text. It is all or nothing:
  commit re-validates every line with the same `lineInput` a hand-typed line
  meets. `uuid` is pinned to ^11 through `overrides` to clear exceljs's one
  advisory.
- **Attachments**: private Vercel Blob (`BLOB_READ_WRITE_TOKEN`), or
  `./.uploads` in development. Production with no token refuses rather than
  writing to ephemeral disk. The key is random and carries nothing from the
  filename. Downloads always go through a route that checks the session, with
  `application/octet-stream`, `Content-Disposition: attachment` and `nosniff`,
  so an upload can never run as a page on this origin. HTML, SVG and JS can't
  be attached at all.
- **4 MB per file, refused in the browser first.** Vercel rejects a request
  body over 4.5 MB itself, with no message the page can show, so the client
  checks size before sending and the action checks again. Server actions are
  allowed 4.5 MB in `next.config.ts`. **Large drawings need direct-to-Blob
  client uploads**, which aren't built yet.
- **Sealed** defaults on and is chosen per RFP. It does nothing until bids
  exist (Phase 3), and it is sealed in the application, not cryptographically
  (see below).

## Forms: `submitKeepingInput`

React 19 clears every uncontrolled field after `<form action={fn}>` finishes,
**including when the action returned a validation error**. The person fixes
one field, resubmits, and is told the others are empty. Found live on the
line form. Any form whose action can refuse its input uses
`onSubmit={submitKeepingInput(action)}` (`lib/forms.ts`). File pickers are
the exception: clearing those is expected.

**`toLocaleString` throws if `dateStyle`/`timeStyle` are combined with
`timeZoneName`**, and took every page with a due date down.
`components/local-time.tsx` uses explicit parts, and a test renders it. Dates
show in the viewer's zone with the zone named; the due-date input is local and
submitted as an ISO instant.

**Stopping the dev server:** `pkill -f 'next dev'` matches the shell running
it and kills your own command. Use `kill $(pgrep -f 'next de[v]')`.

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
  only its recipients see them. **`getSupplierSafeRfp` must then take the
  supplier into account**, not only visibility.
- **Lock line edits once an RFP is open.** Changes after that are addenda
  (Phase 4). Nothing stops editing today because nothing can open an RFP yet.
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
