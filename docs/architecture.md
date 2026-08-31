# Architecture

This document covers the shape of the system and the decisions behind it. For
setup steps see [setup.md](./setup.md); for what is and isn't built yet see
[roadmap.md](./roadmap.md).

## The problem this shape is solving

Two requirements in the product brief drive almost every structural decision:

1. **There is no UI.** Owners and staff work entirely through chat
   ([user story 5.1](./user-stories.md)). So the "front end" is a message, and
   the system has to cope with humans expressing things loosely, changing their
   mind mid-sentence, and sending a photo instead of filling in a form.

2. **There is no fixed schema.** Every micro-business tracks different things
   about its staff, and the brief explicitly requires that new field types can
   be added later without redesign (story 1.8, vision §3.1). So the data model
   cannot be a fixed set of columns.

Both requirements push complexity toward the same place: an untrusted,
ambiguous input source writing to records that have legal and financial weight.
The architecture is mostly about containing that.

## Layers

```
   WhatsApp        Web simulator          (future: SMS, voice)
       │                  │
       └────────┬─────────┘
                ▼
        ChannelAdapter                    packages/channels
      normalised InboundMessage
                │
                ▼
        handleInboundMessage              packages/core/services
     identity · dedupe · session
                │
                ▼
         Agent runtime                    packages/core/agent
   confirmation gate · tool loop
                │
      ┌─────────┴─────────┐
      ▼                   ▼
  LlmProvider          Tools             packages/llm · core/tools
 (mock | Claude)          │
                          ▼
                 Dynamic schema engine    packages/core/schema
              coerce · validate · authorize
                          │
                          ▼
                  Prisma · Neon Postgres  packages/db
```

Each package depends only on those below it. `packages/core/schema` has no
database or network dependency at all, which is why it is the most heavily
tested part of the system.

## Key decisions

### 1. Hybrid schema: fixed columns plus a validated JSON bag

The obvious options for a user-defined schema are both bad. Entity-attribute-value
tables make every read a self-join and lose all type safety. A raw JSON column
gives flexibility but no integrity — nothing stops a pay rate becoming the
string `"eighteen fifty"`, and payroll silently breaks months later.

So records carry both:

- **Fixed columns** for what the platform itself must understand: who someone
  is, when they clocked in, what a leave request covers. These get real
  Postgres types, constraints and indexes.
- **An `attributes` jsonb column** for what the owner cares about, keyed by
  `FieldDefinition.key`.

`FieldDefinition` rows are the account's runtime schema. `compileSchema()` turns
them into the executable rules that guard every write to `attributes`. Adding a
field is an `INSERT`, not a migration.

The important consequence: **nothing writes `attributes` directly.** Every
change goes through `resolveWrite()`, which is what makes the guarantees below
hold everywhere rather than in the handlers someone remembered to check.

### 2. One function decides every write

`resolveWrite()` takes proposed changes and returns them split four ways:

| Bucket | Meaning |
| --- | --- |
| `applied` | Valid, permitted, and different from what's stored |
| `requiresApproval` | Valid, but this actor needs the owner to sign off |
| `rejected` | Not permitted, or not a usable value |
| `unchanged` | Proposed but identical to the current value |

Three user stories that look separate are the same question asked of different
fields, so they get one answer function:

- 2.9 — "know which information I am allowed to change"
- 3.1 — "submit a change request for data that requires approval"
- 4.7 — "prevent an employee from editing their attendance"

It also handles the case chat makes common and forms make impossible: *"update
my emergency contact to Dana and my bonus to 500"* is two different decisions in
one sentence. One is applied, the other becomes an approval request.

`unchanged` exists for a specific reason: without it, re-stating a value someone
already has would create an audit row and an approval request an owner has to
action for no change at all.

### 3. Writes are confirmed by code, never by the model

The agent runtime cannot write to the database on the model's say-so. Tools are
marked `mutates`, and a mutating tool call is **parked** in `PendingAction` with
a plain-language summary. The user is shown exactly what will happen and asked
to confirm.

When their reply arrives, the verdict is decided by `classifyConfirmation()` —
an explicit yes/no vocabulary in ordinary code — **before the model is
consulted at all**. A model that misread "no, not that one" as agreement would
change someone's pay.

The vocabulary is closed and strict. Anything not clearly affirmative or clearly
negative is treated as neither, the parked write is cancelled, and the message is
handled as a fresh instruction. That costs an occasional extra round trip; the
alternative costs an unauthorised write to a payroll record.

This is enforced structurally: no sequence of model outputs can reach a write.
There is a test asserting the confirming turn never reaches the provider.

### 4. Deterministic where possible, model only where necessary

The boundary is drawn deliberately:

| Concern | Handled by |
| --- | --- |
| `"$18.50/hr"` → `18.5` | Code (`coerce.ts`) |
| `"3/4/2026"` → `"2026-03-04"` | Code |
| `"yeah"` → confirmation | Code |
| `"next Friday"` → a date | Model, which has the conversation and timezone |
| Which of two people called Sam | Model asks; code refuses to guess |
| A photographed timesheet | Model |

Anything unambiguous belongs in code, where it is testable and cannot drift
between model versions. The system prompt tells the model to resolve relative
dates itself and pass ISO values, so the ambiguity is resolved once, upstream,
by the component that actually has the context to do it.

### 5. The LLM is a swappable provider

`packages/llm` exposes a provider-neutral interface. Two implementations:

- **`mock`** — a deterministic keyword router. No key, no network. It is what
  makes the whole stack testable and demoable, and it deliberately refuses to
  guess: a plausible-looking wrong answer in a payroll tool is worse than an
  honest "I can't understand that".
- **`anthropic`** — real Claude, via the Messages API with tool use.

Switching is one environment variable. Prompt construction, tool definitions and
the confirmation rule all live in `core`, so changing model never changes
business behaviour.

### 6. WhatsApp is a plug-in, not an assumption

`ChannelAdapter` normalises inbound messages so nothing above it knows which
channel a message came from. The web simulator and WhatsApp both go through the
same `handleInboundMessage`, which means the simulator is a genuine rehearsal
rather than a parallel path that drifts — identity resolution, deduplication, the
agent turn and the reply are the same code in both.

Writing the WhatsApp adapter now, before credentials exist, was the point: an
abstraction with one implementation is a guess.

### 7. Identity comes from the channel

On WhatsApp the sender's phone number is asserted by the platform, so it is the
trust anchor. A message claiming "this is the owner" carries no weight.

Staff are additionally **pinned to their own record** in `resolveEmployeeId()`,
regardless of what the model passed — so neither a prompt injection nor a model
slip can redirect a read or a write onto a colleague.

Unrecognised senders get no reply at all, rather than an error. Replying would
confirm to a stranger that a business uses the platform, and would let anyone
burn tokens for free.

### 8. Everything is auditable

Chat is a lossy medium and these records have legal weight (vision §3.4).
`DataChange` is append-only and records the actor, before and after values, and
the **verbatim** human justification — never summarised, because if it is read
back in a dispute it has to be theirs.

Attribute updates and their audit rows are written in one transaction, so a
partial failure cannot leave a value changed with no record of who changed it.

## Data model notes

Fifteen models in
[`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma), which
carries per-model commentary. The ones worth knowing:

- **`FieldDefinition`** — the runtime schema. Carries provenance (`source`,
  `confidence`) so we know whether a human chose a field or an LLM inferred it
  from a spreadsheet. Archived rather than deleted, so historical values stay
  interpretable.
- **`ApprovalRequest`** — one envelope for field changes, leave and attendance
  corrections, so "everything waiting on me" (3.4) is a single query. `seq` is a
  Postgres sequence rendered as `REQ-42`, giving users a short handle (3.3)
  without an application-level counter that could collide.
- **`AttendanceEntry`** — `workDate` is stored separately from the timestamps
  because "which shift day is this" is a business question, not a UTC one: an
  overnight shift ending at 2am belongs to the previous work day.
- **`Policy`** — versioned rather than overwritten, because attendance approved
  last month must stay explainable under the rules in force at the time.
- **`RosterImport`** — parsing is staged (`NEEDS_REVIEW` before `APPLIED`). An
  owner's staff list is not something to silently guess at.

## Neon and Prisma 7

Prisma 7 has no query engine binary; it connects through a driver adapter, and
connection URLs moved from `schema.prisma` into `prisma.config.ts`. That splits
cleanly along the lines Neon wants:

| | Endpoint | Why |
| --- | --- | --- |
| CLI (`prisma.config.ts`) | direct (`DATABASE_URL_UNPOOLED`) | Migrations issue DDL and take advisory locks; neither survives a transaction pooler |
| Runtime (`src/client.ts`) | pooled (`DATABASE_URL`) | Serverless invocations would otherwise exhaust Postgres connection slots |

Both variable names match what the Neon integration for Vercel injects, so
nothing needs remapping on deploy.

The client connects **lazily**, on first use rather than on import. Next.js
imports every route module while collecting build metadata, and an eager client
would make a production build fail without credentials.

## Why Next.js route handlers rather than a separate API server

The original plan was a standalone Fastify service. Deploying to Vercel means
serverless functions, where an always-on process doesn't fit, so the API surface
is Next.js route handlers instead — one deployable.

All domain logic lives in `packages/core` and none of it imports Next, so this
is a thin adapter rather than a commitment. A dedicated always-on service will
eventually be needed anyway for scheduled work (overtime warnings, shift
reminders, expiring certifications), and at that point it can import the same
`handleInboundMessage` and tool registry.

## Testing approach

64 tests, no database or network required, because the parts worth testing were
built not to need them:

- **`schema/engine.test.ts`** (29) — coercion of what people actually type,
  permission outcomes, locked records, no-op detection, visibility.
- **`agent/runtime.test.ts`** (11) — the confirmation gate, against an
  in-memory store and a scripted provider. The runtime depends on a
  `ConversationStore` port precisely so this is possible; the code under test is
  the code that ships.
- **`channels/whatsapp.test.ts`** (13) — webhook parsing, including malformed
  payloads and signature verification.
- **`llm/mock.test.ts`** (11) — intent routing, and that the mock never calls a
  tool the runtime didn't offer.
