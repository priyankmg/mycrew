# mycrew

Chat-enabled workforce management for micro businesses.

Owners with one to fifteen staff don't want an HR portal. They want to manage
their team the way they already do — over WhatsApp. mycrew replaces the paper
register and the group chat with a conversation that keeps proper records:
attendance, leave, approvals and a compliant audit trail, with no forms, no
logins and no setup.

- [Product vision (v2)](./micro_hcm_product_vision_v2.pdf) — market, targeting,
  monetisation. ([v1](./micro_hcm_product_vision.pdf) is kept for the phased
  rollout table, which v2 drops.)
- [User stories](./docs/user-stories.md) — the product brief
- [Architecture](./docs/architecture.md) — how it's built and why
- [Security](./docs/security.md) — confidentiality and encryption design
- [Setup](./docs/setup.md) — getting it running
- [Verification](./docs/verification.md) — how to check the foundation holds
- [Status and roadmap](./docs/roadmap.md) — what's built, what's next

## Status

**Foundation, verified.** The architecture, data model and safety properties are
built and covered by 112 tests that need neither a database nor a network. The
schema migrates cleanly onto Neon Postgres, and reading and changing staff
records in conversation works end to end — field-level permissions, approval
routing, confirm-before-write and audit all confirmed against a live database.
See [verification](./docs/verification.md) to reproduce it.

Clocking in, leave, approvals, hiring and account onboarding work in
conversation. See the [roadmap](./docs/roadmap.md) for a story-by-story
breakdown.

## Quickstart

Needs Node 20+ and a Neon Postgres database.

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # add your Neon connection strings
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
npm test          # 112 tests, no database needed
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

## Confidentiality

Owners are being asked to put pay rates, addresses and eventually bank details
into a chat thread, so "who else can see this?" is the first question that
matters. Phase 1 answers it, and answers it accurately:

- **Encrypted on every hop, and at rest.** TLS throughout; sensitive fields
  additionally encrypted by the application under per-account keys before they
  reach Postgres, because storage-at-rest protects a stolen disk and little
  else.
- **Confidentiality is a property of each field**, carried on
  `FieldDefinition` alongside who may read and edit it — so a field an owner
  invents themselves is covered without any central list knowing its name. New
  fields default to confidential.
- **The most sensitive data never enters a chat message.** Bank details and
  government identifiers are collected through a short-lived single-use link,
  not typed into WhatsApp.
- **We do not claim end-to-end encryption**, because it would be false. On the
  WhatsApp Business Cloud API, Meta decrypts message content and forwards it to
  our webhook — true of every business on WhatsApp. That belongs in the first
  line of a security answer, not the footnotes.

**Built so far:** field sensitivity is part of the schema and defaults to
confidential, errors no longer carry their message into logs or responses, and
the chat simulator refuses to answer on a production deployment.
**Not yet built:** the encryption itself, and the secure-link collection flow.
So today's accurate claim is "encrypted in transit, and at rest by the
database" — not the per-account key story above, which is the next step.

The full design, including exactly what we will and won't say to customers, is
in [security.md](./docs/security.md).

## Licence

MIT — see [LICENSE](./LICENSE).
