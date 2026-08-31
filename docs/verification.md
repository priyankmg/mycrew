# Verifying the foundation

A checkpoint for deciding whether the foundation is sound enough to build
Phase 1 on top of.

The goal is not "does it run". It is to check the three claims the rest of the
product depends on, because each is expensive to change later:

1. **An account's schema is data.** A field can be added at runtime, with no
   migration and no deploy, and it behaves like a first-class field
   immediately — validated, permission-checked, and readable back.
2. **The model never writes unattended.** Every change is described in advance
   and requires a human yes. A no leaves the database untouched.
3. **Permissions hold at the field level.** Staff can change their own
   emergency contact, must ask for approval on a compliance date, and cannot
   touch their pay rate — all in one uniform code path.

Steps 1 and 2 take about fifteen minutes together. Step 1 needs nothing but
Node; step 2 is where the real verification happens.

---

## Step 1 — Without a database (2 minutes)

```bash
npm install
npm run typecheck
npm test
```

Expect **67 passing tests, 0 failing**, across three packages. No database and
no network are involved, which is deliberate: the logic worth trusting is
testable in isolation.

Two of those tests are the ones to actually read, because they assert the
safety property rather than merely exercising it:

- `packages/core/src/agent/runtime.test.ts` — "does not call the tool before
  the user confirms" asserts the model is *never consulted* on a confirming
  turn. A yes or no is classified by ordinary code before any provider call.
- `packages/core/src/schema/engine.test.ts` — one write carrying an allowed
  field, an approval-gated field and a forbidden field is split correctly into
  applied, pending and rejected.

If you only have two minutes, `npm test` plus skimming those two files is the
highest-value part of this document.

---

## Step 2 — Against live Postgres

This is the part that has **not** been verified yet: there were no Neon
credentials at build time, so migrations have never run against a real
database. Doing this is the core of the checkpoint.

### 2a. Get a database

Following the Vercel-first plan:

1. Import this repo into Vercel.
2. In the Vercel project, **Storage → Create → Neon Postgres**. The
   integration sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for you.
3. Pull them down for local use:

```bash
npx vercel link
npx vercel env pull .env
```

If you'd rather not involve Vercel yet, create a project at
[console.neon.tech](https://console.neon.tech), then `cp .env.example .env` and
paste both connection strings in. Use a **separate Neon branch** for local work
so you never migrate over production data.

Both names are what the Neon integration injects, so nothing needs remapping
on deploy. The two are not interchangeable: migrations need the direct URL
because DDL and advisory locks don't survive a transaction pooler, while the
app needs the pooled one so serverless invocations don't exhaust connection
slots.

### 2b. Migrate and seed

```bash
npm run db:generate
npm run db:migrate    # creates the 15 tables
npm run db:seed
```

The seed prints a summary and is idempotent — **run it twice** and confirm the
field count doesn't grow. (A key-derivation mismatch that broke exactly this
was found and fixed while writing this guide, so it's worth re-checking.)

Then:

```bash
npm run dev           # http://localhost:3000
```

You get **Rosie's Cafe**, owner **Priya Mohan**, staff **Sam Ortiz** (Barista,
$18.50/hr) and **Dana Vega** (Kitchen assistant, $17/hr).

---

## Step 3 — Five scenarios in the simulator

Use the user picker at the top to switch between Priya (owner) and Sam (staff).
Switching identity is the whole point: the same sentence should behave
differently depending on who sends it.

> **On phrasing.** These run on the deterministic mock provider, which is a
> keyword router, not a language model — it understands the shapes below and
> little else. That is a property of the stand-in, not of the system: the
> tools, permissions and confirmation gate are provider-agnostic. To check real
> language understanding, set `MYCREW_LLM_PROVIDER=anthropic` and
> `ANTHROPIC_API_KEY` in `.env`, restart, and then phrase things however you
> like. Doing both is the useful comparison — identical outcomes, different
> flexibility of input.

### 1. Field-level read permissions

**As Sam:** `show my record`

Sam sees his own pay rate and pay basis, but there is **no "Private notes"
line** — that field is `OWNER_ONLY` for visibility.

**As Priya:** `list the team`

Both staff, with private notes visible.

*Proves:* one projection function enforces read visibility per field, per role.

### 2. The confirmation gate, refused

**As Sam:** `update my emergency contact name to Alex Ortiz`

Expect a summary of the exact change and a yes/no prompt — **click No.**

Then `show my record` and confirm the name did **not** change.

*Proves:* a described-but-refused change writes nothing.

### 3. The confirmation gate, accepted

**As Sam:** the same sentence again, but **click Yes.**

Expect a confirmation, and `show my record` now reflects it.

*Proves:* the write path works, and consent is what distinguishes scenario 2
from scenario 3 — nothing else differs.

### 4. Approval routing

**As Sam:** `update my food handler card expiry to 2027-01-15`

The summary should say it will be sent to the manager for approval, not
applied. Say **Yes**, and it's filed as a request.

This field is worth noting: it was added at runtime by the seed via `addField`,
not declared in `schema.prisma`. It validates as a date, enforces its own edit
policy, and is addressable in chat — that is claim 1 from the top of this
document, demonstrated end to end.

*Proves:* `EMPLOYEE_REQUEST` fields queue an approval instead of writing.

### 5. Refusal without a dead end

**As Sam:** `update my pay rate to 25`

Expect a plain explanation that pay rate is the manager's to change — and
**no** yes/no prompt, since there is nothing to confirm.

*Proves:* `OWNER_ONLY` denies staff writes. (The runtime used to ask for
confirmation here before doing nothing; fixed in the same pass as this guide.)

Finally, **as Priya:** `show my record`. An owner isn't an employee, so expect
to be asked which member of staff you meant rather than an error.

---

## Step 4 — Confirm the audit trail

```bash
npm run db:studio
```

- **DataChange** — one row per applied change, with old and new value, actor
  and source. Scenario 3 should appear; scenario 2 should **not**.
- **ApprovalRequest** — one pending row from scenario 4.
- **Message** — the full transcript, inbound and outbound.
- **FieldDefinition** — 5 system fields plus `food_handler_card_expiry`.

That DataChange has an entry for the accepted change and nothing for the
refused one is the single most important row in the database to look at.

---

## What this does not verify

Being explicit, so the checkpoint isn't mistaken for more than it is:

- **No Phase 1 user stories are implemented.** Attendance, leave, shifts,
  onboarding surveys and roster import exist as tables and, in some cases, as
  mock intents, but have no tools behind them. Only three tools are wired:
  `get_employee_record`, `update_employee_fields`, `list_employees`. See
  `docs/roadmap.md` for the per-story status.
- **WhatsApp is unproven against Meta.** Payload parsing and signature
  verification are unit-tested, but no real webhook has been received.
- **Claude is unproven against the real API.** The provider is written against
  the SDK and type-checks; it has not been run with a live key.
- **No load, concurrency, or multi-account isolation testing.**
- **No auth on the admin surface.** The simulator trusts its user picker, which
  is fine locally and must not ship.

---

## The checkpoint

Ready for Phase 1 if:

- [ ] 67 tests pass
- [ ] Migrations apply cleanly to a real Neon database
- [ ] Seed is idempotent across two runs
- [ ] Scenarios 1–5 behave as described
- [ ] `DataChange` records the accepted change and not the refused one

If all five hold, the structural claims are sound and Phase 1 is additive:
new tools registered against the existing runtime, without reopening the
schema engine or the confirmation gate.
