# Supplier RFP Portal

Run RFPs and RFQs with many suppliers at once: one package, updates, bid
rounds, side-by-side comparison. Suppliers only ever see their own view and
the fields marked shared.

**Test data only** until security approves where real bid data is hosted. No
real DLR pricing, site data or budget figures.

Built phase by phase from the build spec. **Phase 1 is done**: admin sign-in,
the supplier directory, CSV import.

## Running it locally

Needs Node 20.9+ and a Postgres database.

```bash
npm install
cp .env.example .env           # set DATABASE_URL and AUTH_SECRET
npm run db:migrate
SEED_ADMIN_EMAIL=you@company.com npm run db:seed
npm run dev
```

Open http://localhost:3000 and sign in with the seeded address. With no
`RESEND_API_KEY`, the sign-in email prints in the terminal. Copy the link
from there.

## Who can sign in

Only addresses in the `users` table can sign in; nobody can sign up. An
address that isn't listed gets the same "check your email" page and no email
is sent, so the form can't be used to find out who has access.

```bash
npm run user:add -- someone@company.com admin    # can edit
npm run user:add -- someone@company.com viewer   # read-only
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Tests (need a Postgres test database; see below) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run db:generate` | New migration after editing `lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Ten invented suppliers (UPS, batteries, chillers) |

The tests truncate their database, so they use a separate one:
`TEST_DATABASE_URL`, defaulting to `postgres://rfp:rfp@localhost:5432/rfp_test`.
Run `DATABASE_URL=<test url> npm run db:migrate` once to set it up.

## Deploying (Vercel + Neon)

1. Make a new Vercel project for this repository. Don't reuse the PPL project.
2. Create a Neon database and set `DATABASE_URL` to its **pooled** connection
   string.
3. Set `AUTH_SECRET` (`npx auth secret`), `RESEND_API_KEY` and `EMAIL_FROM`.
4. Run `npm run db:migrate` against the Neon database, then
   `npm run user:add -- <you> admin`.
