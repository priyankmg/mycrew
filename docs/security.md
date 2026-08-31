# Confidentiality and encryption

Design for Phase 1, and the target the Phase 1 work is measured against.

Step 0 of the [roadmap](./roadmap.md) is built: the simulator no longer answers
on a production deployment, field sensitivity is part of the schema, and errors
no longer carry their message into logs or HTTP responses. Encryption itself is
**not** built — see "Phase 1 scope" at the end for what remains and in what
order.

## The concern, stated properly

An owner is being asked to put their staff's pay rates, home addresses and
eventually bank details into a WhatsApp thread. Their reasonable question is:
*who else can see this?*

That question deserves a precise answer rather than a reassuring one, because
the honest answer is not "nobody" and a customer who later discovers we
overstated it will be right to stop trusting us.

## The constraint we cannot engineer away

**WhatsApp messages to a business are not end-to-end encrypted to us, and
cannot be.**

Personal WhatsApp chats are end-to-end encrypted: Meta cannot read them. But
when a business receives messages through the WhatsApp Business Cloud API, Meta
terminates that encryption on its own servers and forwards the plaintext to our
webhook. This is how the Cloud API works for every business on it, not a
weakness of our implementation.

This has an uncomfortable implication worth facing directly: for an owner whose
status quo is an ordinary WhatsApp group chat with their crew, moving to us
*reduces* encryption on that one leg. Their group chat is E2E; a conversation
with our number is not.

Two things follow, and they shape the whole design:

1. **We must never claim end-to-end encryption.** See "What we will not claim".
2. **The strongest protection is for the most sensitive data never to be typed
   into chat at all.** That is a product decision, not a cryptographic one, and
   it is the core of the design below.

(A Business Solution Provider running on-premise WhatsApp infrastructure changes
the trust boundary somewhat, but not the fundamental point, and it is far beyond
Phase 1's operational budget.)

## Design

### 1. Sensitive data leaves the chat channel

The zero-UI promise is what makes this product work, so it should hold for the
ordinary 95% of interactions: clocking in, swapping a shift, asking for
Thursday off, correcting a phone number. None of that is sensitive enough to
justify friction.

For the genuinely dangerous fields — government identifiers, bank account and
routing numbers, photographs of ID documents — the assistant should not accept
the value in chat, even if the user offers it. It should reply with a
single-use link to a minimal secure page, and the value should be submitted
there over TLS directly to us.

```
Owner: sam's social is 123-45-6789
Bot:   I won't record that here — chat isn't the right place for it.
       Here's a private link, good for 15 minutes: https://…/c/8f2a…
       (I've deleted the number from this conversation.)
```

Properties the link needs: a cryptographically random single-use token, a short
expiry, scoped to exactly one field on one employee, invalidated on submission,
and never logged. Fields carrying `RESTRICTED` sensitivity (below) are the ones
routed this way.

This is worth the friction precisely because it is rare, and it changes what we
can tell a customer: their staff's bank details were never in a WhatsApp
message, so no amount of Meta or carrier access exposes them.

It also requires the inbound path to **redact on arrival** — if a user pastes a
bank number anyway, it must be scrubbed from the stored transcript and from
logs, and ideally deleted from the WhatsApp thread. Detection is pattern-based
and therefore imperfect, so it is a mitigation, not a guarantee.

### 2. Field sensitivity becomes part of the schema

The dynamic schema already carries per-field policy — `visibility` decides who
may read a field, `editPolicy` who may change it. Confidentiality is the same
kind of question and belongs in the same place, so `FieldDefinition` gains a
classification:

| Level | Meaning | Treatment |
| --- | --- | --- |
| `NORMAL` | Job title, shift preference | Standard |
| `CONFIDENTIAL` | Pay rate, home address, emergency contact, owner notes | Encrypted at rest; redacted from logs; excluded from LLM prompts unless the turn needs it |
| `RESTRICTED` | Government ID, bank details, ID document images | All of the above, plus never accepted in chat — secure-link only |

Putting this on the field definition rather than in a hardcoded list is what
makes it survive contact with the product: owners invent their own fields
(story 1.8), so "Visa expiry" or "Garnishment order" will exist without us
having anticipated them. The onboarding survey and roster import should propose
a classification when creating a field, and the owner can raise it.

Defaulting matters. A new field of unknown meaning should default to
`CONFIDENTIAL`, not `NORMAL` — the failure should be excess caution.

### 3. Encryption at rest, above what the database gives us

Neon encrypts storage at rest already, which protects against a stolen disk and
essentially nothing else. It does not protect against a leaked read-only
connection string, an over-broad support query, or a logic bug that returns
another tenant's row — the realistic failure modes.

So `CONFIDENTIAL` and `RESTRICTED` values are encrypted by the application
before they reach Postgres, using envelope encryption: a per-account data key,
wrapped by a master key in a managed KMS, with AEAD (AES-256-GCM) and the
account id plus field key bound in as associated data so a ciphertext cannot be
moved between accounts or fields.

The consequences are real and should be accepted deliberately:

- Encrypted fields cannot be queried by value or sorted in SQL. Acceptable
  because these fields are read per-employee, not aggregated. Payroll totals
  need care.
- Key rotation means re-wrapping data keys, so keys need versioning from day
  one — retrofitting a key id later is painful.
- Losing the master key loses the data. Wanted: it is the property being paid
  for.

Fields payroll arithmetic depends on — `pay_rate` above all — need a decision
rather than a default. Encrypting it means every wage calculation decrypts
first, which is fine for 15 employees and would not be at scale. Phase 1 should
encrypt it and revisit if that assumption breaks.

### 4. In transit

Every hop is TLS, and each needs stating because "we use HTTPS" is not a
threat model:

| Hop | Protection | Status |
| --- | --- | --- |
| Worker ↔ Meta | E2E on the user's device to Meta | Meta's, not ours |
| Meta → our webhook | TLS 1.2+, enforced by Meta | Given |
| Webhook authenticity | HMAC-SHA256 over the raw body (`X-Hub-Signature-256`) | **Built and tested** |
| App → Postgres | TLS via `sslmode=require` | **In place** |
| App → Anthropic | TLS 1.3 | Given |
| Browser → admin surface | HSTS, TLS 1.3 | Vercel default |

Signature verification is the one that stops an attacker forging "clock me out"
for someone else's number, and it exists today in
`packages/channels/src/whatsapp.ts`. It must stay mandatory: a webhook that
falls back to accepting unsigned bodies when the secret is missing is worse than
no verification, because it fails silently.

### 5. The LLM boundary

Every inbound message goes to a model, so the model provider is a data
processor and needs treating as one.

- **Minimise.** The prompt should carry the fields the turn plausibly needs, not
  the whole record. The read projection already filters by role; it should
  filter by sensitivity too.
- **Never send `RESTRICTED` values.** Reference them by name — "bank details on
  file" — never by value.
- **Zero retention.** Anthropic's zero-retention terms should be in place before
  real customer data flows.
- **The mock provider stays.** Being able to run the product with no external
  model at all is a genuine security property, not just a testing convenience.

### 6. Transcripts, logs, and retention

Free-text chat is the least structured and most sensitive store we have — an
owner will type things into it that no schema anticipated. So:

- **Never log message bodies or attribute values.** Log ids, tool names,
  outcomes. The existing error path returns `error.message` to the browser,
  which is right for a dev tool and must be gated before it is exposed.
- **Retain transcripts for a fixed window** (start at 90 days, per-account
  configurable), then delete. `DataChange` is the durable record of what changed
  and stays; the conversation that produced it does not need to.
- **`DataChange` stores old and new values** and therefore inherits the
  sensitivity of its field. Encrypt accordingly — an audit log of decrypted pay
  rates would defeat the point.

### 7. Tenant isolation and access

- Every query is scoped by `accountId`; nothing may derive an account from
  user-supplied input alone. This is the invariant most worth a test that tries
  to break it.
- The admin and simulator surfaces have **no authentication today**, which is
  the largest open hole and blocks any exposed deployment.
- Staff see their own record; owners see their account. That is enforced by the
  schema engine's `visibility` rules, which is why those rules being one code
  path matters.
- Support access to production data should require a break-glass path that is
  logged, not a shared connection string.

## What we will not claim

Marketing copy has to survive a security questionnaire, so these are off
limits:

- ❌ "End-to-end encrypted" — untrue on the WhatsApp leg, by design of the
  Cloud API.
- ❌ "We can't see your data" — untrue; we hold the keys.
- ❌ "Bank-grade" / "military-grade encryption" — meaningless.

What we can say, and defend:

- ✅ Encrypted in transit on every hop, and at rest, with sensitive fields
  additionally encrypted by the application under per-account keys.
- ✅ Bank details and government identifiers are never accepted over chat.
- ✅ Every change to employee data is attributed and auditable.
- ✅ No change is written without an explicit human confirmation.
- ✅ Meta processes WhatsApp messages in transit, as it does for every business
  on WhatsApp. Say it plainly and first.

## Phase 1 scope

Ordered by ratio of risk removed to effort. Items 1–3 had to land before
anything was deployed with real data in it, and have.

1. ✅ **The simulator is closed on a deployment.** Both its endpoints answer 404
   whenever `NODE_ENV=production` unless `MYCREW_SIMULATOR_TOKEN` is set, and
   the same response covers "switched off" and "wrong token" so an
   unauthenticated caller learns nothing. Fails closed: forgetting to configure
   it leaves the data unreachable rather than public.

   This is not owner authentication. Owners logging in to see their own account
   needs a real session design and is still open (story 6.15).

2. ✅ **`sensitivity` on `FieldDefinition`**, defaulting to `CONFIDENTIAL`, with
   the system fields classified and `NORMAL` chosen explicitly where it applies.
   The compiled schema exposes `sensitivityOf`, `acceptsChatInput` and
   `redact`, so consumers ask the schema rather than keeping their own list. An
   unknown key answers `RESTRICTED`, so a typo withholds data instead of
   leaking it.

3. ✅ **Errors no longer carry their message.** Prisma builds messages
   containing the values it was handed, so a failed write used to echo a pay
   rate back over HTTP and into the logs. Messages now reach the client in
   development only; logs get the error name, a trimmed stack and a reference
   id shared with the response.

4. **Envelope encryption** for `CONFIDENTIAL` and above, with key versioning
   from the first commit.
5. **Secure-link collection** for `RESTRICTED` fields, plus inbound redaction.
   The classification and `acceptsChatInput` exist; nothing consults them on
   the inbound path yet, so a `RESTRICTED` value pasted into chat is currently
   stored like any other.
6. **Transcript retention** job.
7. **Zero-retention agreement** with Anthropic before real data flows.
8. **A tenant-isolation test** that actively attempts cross-account reads.

Items 4 and 5 are what make the customer-facing claims above true, so they gate
the first paying customer rather than the first deploy. Until then the honest
statement is "encrypted in transit, and at rest by the database" — not "sensitive
fields are encrypted under per-account keys".
