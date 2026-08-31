# Setup

## Requirements

- Node.js 20 or newer (developed on 24; the test suite uses Node's native
  TypeScript support, so no build step is needed to run tests)
- A Neon Postgres database

## 1. Install

```bash
npm install
```

npm may report that some packages have install scripts awaiting approval. The
ones this project needs are already recorded in `allowScripts` in
`package.json`: Prisma's query engines, esbuild's binary and fsevents. If a
fresh clone reports them as pending, approve them explicitly:

```bash
npm approve-scripts prisma @prisma/engines esbuild fsevents
```

## 2. Create the database

The project is set up for the **Neon Postgres integration for Vercel**, which
provisions the database and injects the connection variables automatically.

### Via Vercel (the deploy path)

1. Import this repository into Vercel and set the project root to `apps/web`.
2. In the Vercel project, add the **Neon** integration from the marketplace and
   create a database.
3. The integration sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for you.
   These are exactly the names the code expects — no remapping needed.

### For local development

Pull the same variables down from Vercel:

```bash
npx vercel link
npx vercel env pull .env
```

Or copy the example and paste connection strings from the Neon console:

```bash
cp .env.example .env
```

```ini
# Pooled endpoint — note the "-pooler" in the host. Used at runtime.
DATABASE_URL="postgresql://…@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Direct endpoint — no "-pooler". Used by migrations.
DATABASE_URL_UNPOOLED="postgresql://…@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

Both are needed. Migrations issue DDL and take advisory locks, which cannot go
through Neon's transaction pooler; the running app wants the pooler so
serverless invocations don't exhaust connection slots.

Consider creating a separate Neon **branch** for local work so you never run a
migration against production data.

## 3. Migrate and seed

```bash
npm run db:generate    # generate the Prisma client
npm run db:migrate     # create the schema
npm run db:seed        # demo account: 1 owner, 2 staff, a custom field
```

Or all of it, plus install:

```bash
npm run setup
```

## 4. Run

```bash
npm run dev
```

Open http://localhost:3000 for the chat simulator. Pick who you're chatting as
in the sidebar — the owner and the two staff members have different permissions,
which is the most useful thing to poke at.

## Connecting real Claude

By default the app runs on a deterministic mock provider that understands a
handful of set phrases and no more. To use Claude:

```ini
MYCREW_LLM_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-…"
ANTHROPIC_MODEL="claude-sonnet-4-6"
```

Restart the dev server. The sidebar badge shows which provider is live.

## Connecting WhatsApp

Not required for development. When you have a Meta app with WhatsApp Cloud API
access:

```ini
WHATSAPP_ACCESS_TOKEN="…"
WHATSAPP_PHONE_NUMBER_ID="…"
WHATSAPP_VERIFY_TOKEN="a-secret-you-choose"
WHATSAPP_APP_SECRET="…"
```

Point the webhook at `https://your-domain/api/whatsapp` and use the same
`WHATSAPP_VERIFY_TOKEN` in Meta's console. The `GET` handler answers the
subscription challenge; `POST` verifies the `X-Hub-Signature-256` header before
processing anything.

Users are matched by phone number, so a `User` row needs a `phoneE164` matching
the sender's WhatsApp number. Unrecognised numbers are ignored deliberately.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app |
| `npm test` | Run all tests (no database needed) |
| `npm run typecheck` | Typecheck every package |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations without prompting (CI/production) |
| `npm run db:studio` | Browse data in Prisma Studio |
| `npm run db:seed` | Reseed demo data (idempotent) |

## Troubleshooting

**`DATABASE_URL is not set`** — no `.env` at the repository root, or it has no
`DATABASE_URL`. The root `.env` is the only one; the packages don't have their
own.

**Migrations hang or fail on a lock** — you're pointing at the pooled endpoint.
`DATABASE_URL_UNPOOLED` must be the host *without* `-pooler`.

**Simulator says a user isn't registered** — run `npm run db:seed`.

**`Cannot find module '@mycrew/core'`** — run `npm install` from the repository
root so npm links the workspaces.
