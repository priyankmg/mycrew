# Status and roadmap

This is a **foundation**, not Phase 1. The architecture, data model and the
hard-to-change safety properties are built and tested. Most of the
conversational features are not.

The honest summary: you can hold a real conversation that reads and changes
staff records, with permissions, approvals, confirmation and an audit trail all
working end to end. You cannot yet clock in, request leave, or approve a
request through chat.

## What changed in vision v2

Three things in
[micro_hcm_product_vision_v2.pdf](../micro_hcm_product_vision_v2.pdf) bear on
what gets built next.

**A named beachhead.** v2 adds a three-tier targeting plan, and tier 1 is
*mobile field trades* — landscaping crews, cleaning, contractors, HVAC,
plumbers, event caterers (~1.2M US firms) — chosen for being non-desk, already
WhatsApp-native, and heavy on cash payouts. Micro-retail and hospitality, which
includes cafes, is tier 2.

Worth noticing because the demo account is a cafe. That was picked before there
was a beachhead, and a landscaping crew across two job sites would exercise
different things: a crew working somewhere other than a fixed address, clock-ins
that need a location, and a genuinely dispersed team where nobody sees a
noticeboard. The scenarios in [verification.md](./verification.md) name the cafe
staff, so changing the seed means updating that too — a deliberate change, not a
drive-by one.

**WhatsApp's delivery rules are now explicit.** §5.5 names the 24-hour session
window and approved message templates. This is a hard constraint on anything
proactive; see step 6 below.

**The phased rollout table is gone.** v1 §5 defined Phase 1/2/3; v2 drops it in
favour of targeting and monetisation. "Phase 1" in this repo therefore still
means v1's definition — ingestion, time clock, shift logging, policy survey —
and that mapping now lives here rather than in the current vision doc.

## Story coverage

Against [user-stories.md](./user-stories.md).

Legend: **Done** · **Model** (data model and services exist, no chat tool) ·
**Not started**

### 1. Account management

| | Story | Status |
| --- | --- | --- |
| 1.1 | Create a workforce account | Model |
| 1.2 | Manage the account | Model |
| 1.3 | Configure policies | Model — `Policy` is versioned; no survey generator |
| 1.4 | Owner works through chat | **Done** |
| 1.5 | System initiates an account from inputs | **Done** — `seedSystemFields` |
| 1.6 | System edits account details | Not started |
| 1.7 | Step-by-step onboarding guidance | Model — `OnboardingSession` exists, flow doesn't |
| 1.8 | Flexible employee database structure | **Done** — this is the schema engine |

### 2. Employee management

| | Story | Status |
| --- | --- | --- |
| 2.1 | Onboard new employees | Model — needs an `add_employee` tool |
| 2.2 | Edit existing employee information | **Done** |
| 2.3 | Pull records of all employees | **Done** |
| 2.4 | View history of data changes | Model — `DataChange` is written, nothing reads it back |
| 2.5 | Owner works through chat | **Done** |
| 2.6 | Direct text input or document upload | Model — `RosterImport` exists, no parser |
| 2.7 | Employee views their job information | **Done** |
| 2.8 | Employee changes their information | **Done** |
| 2.9 | Employee knows what they may change | **Done** |
| 2.10 | Employee works through chat | **Done** |
| 2.11 | System updates the database per inputs | **Done** |
| 2.12 | System notifies employees on onboarding | Model — `Notification` queues, nothing drains it |

### 3. Request management

| | Story | Status |
| --- | --- | --- |
| 3.1 | Employee submits a change request | **Done** — raised automatically by policy |
| 3.2 | Employee checks request status | Model |
| 3.3 | Look up by id, date or description | Model — `seq` and `summary` exist for this |
| 3.4 | Owner lists all open requests | Model — single-table query by design |
| 3.5 | Bulk action from free text | Not started |
| 3.6 | Owner decides one or more requests | Model |
| 3.7 | System pulls a list of requests | Model |
| 3.8 | System asks clarifying questions | Partial — ambiguous names are queried, not guessed |
| 3.9 | System confirms before every write | **Done** |

### 4. Leave and attendance

| | Story | Status |
| --- | --- | --- |
| 4.1 | Record attendance by message | Model — `AttendanceEntry` ready |
| 4.2 | Record a leave request | Model — `LeaveRequest` ready |
| 4.3 | Edit existing leave | Model |
| 4.4 | Free-text justification | **Done** at the storage layer — stored verbatim |
| 4.5 | Owner views and actions leave | Model |
| 4.6 | Pull attendance and leave records | Model |
| 4.7 | Prevent employees editing attendance | **Done** — `isLocked` in the engine |
| 4.8 | Record conversations against a record | **Done** |
| 4.9 | Detect late in / early out and ask why | Model — `AttendanceFlag`, `Shift` ready; no detection |
| 5.0 | Forward leave requests to the owner | Model |
| 5.1 | Manage leave/attendance workflows | Not started |

### 5. User experience

| | Story | Status |
| --- | --- | --- |
| 5.1 | Interact via WhatsApp | Adapter **done**, needs Meta credentials |

### 6. Security and confidentiality

Added after the original brief; design in [security.md](./security.md).

| | Story | Status |
| --- | --- | --- |
| 6.1 | Be told plainly who can see the data | Not started — documented, not surfaced in product |
| 6.2 | Encrypted in transit and at rest | Partial — TLS on every hop; no application-level encryption |
| 6.3 | Provide bank details / IDs outside chat | Not started |
| 6.4 | Mark any field confidential | **Done** in the schema — `sensitivity` on `FieldDefinition`, default confidential; nothing acts on it yet beyond redaction |
| 6.5 | Staff cannot see each other's records | **Done** — schema engine `visibility`, enforced in one path |
| 6.6 | Transcripts not retained indefinitely | Not started |
| 6.7 | Details not visible to colleagues | **Done** (same mechanism as 6.5) |
| 6.8 | Share a document without it living in chat | Not started |
| 6.9 | Encrypt confidential fields per account | Not started |
| 6.10 | Reject unsigned webhooks, no fallback | **Done** — HMAC-SHA256, unit-tested |
| 6.11 | Never log message bodies or values | **Done** for errors — messages withheld from logs and from responses outside development; `schema.redact()` available for attribute bags |
| 6.12 | Minimise data sent to the LLM | Partial — role projection exists; no sensitivity filter |
| 6.13 | Redact sensitive values pasted into chat | Not started — `acceptsChatInput()` exists, inbound path doesn't consult it |
| 6.14 | Scope every query by account | **Done** by convention — no test enforces it |
| 6.15 | Require auth on non-chat surfaces | Partial — simulator closed in production (404 unless `MYCREW_SIMULATOR_TOKEN`); owner accounts still unbuilt |

## Suggested next steps

In dependency order. The first three are the ones that make the product
demonstrable. Step 0 is not demonstrable at all and still goes first, because
it is what makes it safe to put real staff data in.

### 0. Confidentiality groundwork (stories 6.1–6.15)

Design in [security.md](./security.md). **This step is done** — the three items
that gated a deployment holding real data:

- ✅ **The simulator is closed on a deployment.** Both endpoints answer 404 when
  `NODE_ENV=production` unless `MYCREW_SIMULATOR_TOKEN` is set, with one
  response for "off" and "wrong token". Owner accounts are still unbuilt, so
  story 6.15 is partial, not closed.
- ✅ **`sensitivity` on `FieldDefinition`**, defaulting to confidential, system
  fields classified, and `sensitivityOf` / `acceptsChatInput` / `redact` on the
  compiled schema so consumers ask the schema instead of keeping their own list.
- ✅ **Errors no longer carry their message** into logs or responses outside
  development, because Prisma puts the values it was given into the message.

Done in this order because steps 1–3 below all write employee data, and
retrofitting a classification once several tools depend on the schema shape
costs more than adding it first.

Still open before a first paying customer: envelope encryption for confidential
fields (with key versioning from the first commit), secure-link collection so
bank details and government identifiers never enter a chat message, a transcript
retention job, and a zero-retention agreement with Anthropic.

### 1. Attendance tools (stories 4.1, 4.9)

The flagship interaction: "clocking in" should just work. Needs a
`record_attendance` tool plus an `attendance-service` that computes `workDate`
in the account's timezone, compares against `Shift` to set `LATE_IN` /
`EARLY_OUT`, and asks for a justification when a flag is raised.

Follow the pattern in `employee-service.ts`: resolve through the schema engine,
write attributes and audit rows in one transaction.

### 2. Leave and approval tools (3.2, 3.4, 3.6, 4.2, 4.5)

`ApprovalRequest` is already the single envelope, so `list_pending_requests` and
`decide_request` are straightforward reads and writes. `decide_request` must be
`mutates: true` so it inherits the confirmation gate.

Approving a `FIELD_CHANGE` should apply its `payload.changes` back through
`applyEmployeeChanges` with a `SYSTEM` actor, rather than writing attributes
directly — otherwise approved changes skip validation.

### 3. Turn on Claude (already wired)

Set `MYCREW_LLM_PROVIDER=anthropic`. Worth doing early: the mock's keyword
routing will start to feel limiting as soon as there are more than a few tools,
and the prompt needs real conversations to tune against.

### 4. Onboarding survey (1.3, 1.7)

Drive `OnboardingSession` step by step, generating `FieldDefinition` rows from
the "what do you want to track" step and `Policy` rows from the policy step. Use
`FIELD_TEMPLATES` in `system-fields.ts` so accounts converge on the same keys
and types for the same real-world concept.

### 5. Roster import (2.6, vision §3.1)

The dynamic schema engine already accepts proposed (unpersisted) field specs,
which is exactly what this needs: parse the upload, propose fields and rows, set
`NEEDS_REVIEW`, and only write employees after the owner confirms. Store
`confidence` on inferred fields.

### 6. A scheduled worker

Overtime warnings, shift reminders, expiring certifications and draining
`Notification` all need to run on a timer, which serverless request handlers
can't do. This is the point to add the always-on service — it can import
`handleInboundMessage` and the tool registry unchanged.

This is also where WhatsApp's 24-hour session window first bites (vision v2
§5.5). Everything built so far is a reply to an inbound message, which Meta
always permits. A reminder is not: outside 24 hours from someone's last message,
only a **pre-approved template** will be delivered. So this step needs
`OutboundMessage` to carry a template id and variables, the adapter to pick
free-form or template based on conversation staleness, and the templates
themselves submitted to Meta for approval — which takes calendar time and should
be started before the code is needed. The simulator will happily send anything,
so it cannot catch this.

## Known gaps and things to watch

- **No authentication on the API routes.** The simulator lets you pick any user.
  Fine for local development, must not ship. Real channels authenticate via the
  platform (a verified phone number); the web surface needs its own login before
  any hosted deployment is exposed. Story 6.15; first item of step 0.
- **Nothing is encrypted above what Neon provides.** Storage-at-rest protects a
  stolen disk and little else. Sensitive fields need application-level
  encryption — see [security.md](./security.md).
- **No message templates.** `send()` posts free-form text only, so nothing can
  be delivered outside WhatsApp's 24-hour window. Invisible until the first
  proactive message.
- **No rate limiting.** Every inbound message can trigger an LLM call.
- **Media isn't downloaded.** `InboundMedia` carries WhatsApp's `mediaId`, but
  nothing resolves it to bytes yet.
- **One tool call per turn.** The runtime honours only the first call in a
  response. Fine for now, and it keeps confirmation prompts about a single
  describable change, but genuinely parallel requests will need revisiting.
- **JSON filtering on `attributes`** goes through Prisma's `path` filters, which
  Postgres supports well. If attribute queries become hot, they'll want GIN
  indexes, which Prisma can't express — expect a raw SQL migration.
- **`Policy` is stored and versioned but not yet enforced anywhere.**
