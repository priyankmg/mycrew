# Status and roadmap

This is a **foundation**, not Phase 1. The architecture, data model and the
hard-to-change safety properties are built and tested. Most of the
conversational features are not.

The honest summary: you can hold a real conversation that reads and changes
staff records, with permissions, approvals, confirmation and an audit trail all
working end to end. You cannot yet clock in, request leave, or approve a
request through chat.

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

## Suggested next steps

In dependency order. The first three are the ones that make the product
demonstrable.

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

## Known gaps and things to watch

- **No authentication on the API routes.** The simulator lets you pick any user.
  Fine for local development, must not ship. Real channels authenticate via the
  platform (a verified phone number); the web surface needs its own login before
  any hosted deployment is exposed.
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
