# mycrew

Chat-enabled workforce management for micro businesses.

Owners with one to fifteen staff don't want an HR portal. They want to manage
their team the way they already do — over WhatsApp. mycrew replaces the paper
register and the group chat with a conversation that keeps proper records:
attendance, leave, approvals and a compliant audit trail, with no forms, no
logins and no setup.

- [Product vision](./micro_hcm_product_vision.pdf) — market, strategy, phasing
- [User stories](./docs/user-stories.md) — the product brief
- [Architecture](./docs/architecture.md) — how it's built and why
- [Setup](./docs/setup.md) — getting it running
- [Verification](./docs/verification.md) — how to check the foundation holds
- [Status and roadmap](./docs/roadmap.md) — what's built, what's next

## Status

**Foundation, pending sign-off.** The architecture, data model and safety
properties are built, and the logic is covered by 67 tests that need neither a
database nor a network. You can read and change staff records in conversation,
with field-level permissions, approvals, confirmation and audit.

Not yet confirmed: migrations have never run against a live Postgres, because
there were no credentials at build time. Doing that is the first step in
[verification](./docs/verification.md). Most conversational features — clocking
in, leave, shifts — are data model only; see the
[roadmap](./docs/roadmap.md) for a story-by-story breakdown.

## Quickstart

Needs Node 20+ and a Neon Postgres database.

```bash
npm install
cp .env.example .env        # add your Neon connection strings
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000. Pick who you're chatting as in the sidebar — the
owner and the two staff members have different permissions, which is the most
interesting thing to try.

It runs without an LLM API key: a deterministic mock provider understands a
handful of set phrases so the whole stack works offline. Set
`MYCREW_LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` for real conversation.

```bash
npm test          # 64 tests, no database needed
npm run typecheck
```

## How it fits together

```
   WhatsApp        Web simulator          (future: SMS, voice)
       └────────┬─────────┘
                ▼
        ChannelAdapter                    packages/channels
                ▼
        handleInboundMessage              packages/core/services
                ▼
         Agent runtime                    packages/core/agent
   confirmation gate · tool loop
      ┌─────────┴─────────┐
      ▼                   ▼
  LlmProvider          Tools             packages/llm · core/tools
 (mock | Claude)          ▼
                 Dynamic schema engine    packages/core/schema
              coerce · validate · authorize
                          ▼
                  Prisma · Neon Postgres  packages/db
```

| Package | Contains |
| --- | --- |
| `packages/db` | Prisma schema (15 models), client, seed |
| `packages/core` | Schema engine, agent runtime, services, tools |
| `packages/llm` | Provider interface; mock and Claude implementations |
| `packages/channels` | Channel abstraction; WhatsApp and web simulator |
| `apps/web` | Next.js app — API routes and the chat simulator |

## The two ideas that shape everything

**The schema is data, not code.** Every micro-business tracks different things
about its staff, so `FieldDefinition` rows *are* the account's schema. They
compile at runtime into the validators and permission rules that guard every
write to a record's `attributes` column. Adding a field is an `INSERT`, not a
migration — while pay rates stay typed and payroll maths stays safe.

**The model never writes.** A mutating tool call is parked with a plain-language
summary of exactly what will happen, and the user is asked to confirm. Their
yes or no is interpreted by ordinary code before the model is consulted at all,
because a model that misreads "no, not that one" would change someone's pay.
It's a structural guarantee, not a prompt instruction.

Both are explained in more depth in the [architecture doc](./docs/architecture.md).

## Licence

MIT — see [LICENSE](./LICENSE).
