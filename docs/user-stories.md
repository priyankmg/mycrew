# User stories

The original product brief, preserved as written. Numbering and wording are
unchanged (including a couple of duplicated numbers in sections 4 and 5), so
that references to a story number stay stable.

See [roadmap.md](./roadmap.md) for what is built against each of these, and
[micro_hcm_product_vision_v2.pdf](../micro_hcm_product_vision_v2.pdf) for the
wider strategy document.

Section 6 was added later and is marked as such.

## Users

1. Company Owner (CO)
2. Employee (E)
3. System (S)

## 1. Account Management

As a CO I want to be able to:

- **1.1** Create a new workforce account
- **1.2** Manage my workforce account
- **1.3** Configure policies for my workforce account
- **1.4** Perform my tasks using a chat interface

As a S I want to be able to:

- **1.5** Initiate a new account based on user inputs
- **1.6** Edit account details based on user inputs
- **1.7** Provide step-by-step guidance to CO during onboarding from company
  details, to number of employees, type of employee data to capture — basic pay,
  attendance, schedules, free feedback notes, features they want to use (to be
  defined later e.g. attendance)
- **1.8** Keep the employee database structure flexible to allow for new types
  of fields to be added based on new information user may want to capture in
  future

## 2. Employee Management

As a CO I want to be able to:

- **2.1** Onboard new employees
- **2.2** Edit existing employee information
- **2.3** Pull records of all employees
- **2.4** View history of data changes
- **2.5** Perform my tasks using chat interface
- **2.6** Perform my tasks using direct text inputs or uploading a document

As an E I want to be able to:

- **2.7** View my job information
- **2.8** Make changes to my job information
- **2.9** Know which information I am allowed to change vs not
- **2.10** Perform my tasks using a chat interface

As a S I want to be able to:

- **2.11** Update the employee database as per inputs
- **2.12** Notify employees upon new registration / onboarding by CO

## 3. Request Management

As an E I want to be able to:

- **3.1** Submit change request for a data that requires approval
- **3.2** Check the status of my requests
- **3.3** Check the status of my requests using either an ID, or a date or a
  text based description / context

As a CO I want to be able to:

- **3.4** Retrieve a list of all open requests
- **3.5** Ask the system to take a bulk action based on my free form text
- **3.6** Provide a decision on one or more requests

As a S I want to be able to:

- **3.7** Pull up a list of requests
- **3.8** Ask clarifying follow up questions when there are multiple results to
  a user input
- **3.9** Always make sure I confirm with the user before making a write
  transaction.

## 4. Leave and Attendance

As an E I want to be able to:

- **4.1** Record my attendance by sending a message
- **4.2** Record a leave request
- **4.3** Edit my existing leaves
- **4.4** Provide a justification of my attendance or leave through free text

As a CO I want to be able to:

- **4.4** View my employee's leave requests
- **4.5** Action leave requests
- **4.6** Pull a record of attendance and leaves

As a S I want to be able to:

- **4.7** Prevent an employee from editing their attendance
- **4.8** Record employee and CO conversations or justifications (as-is) in
  context to a specific leave or attendance
- **4.9** Automatically determine if the employee is marking a late
  attendance-in or early out and ask for justification
- **5.0** Forward leave requests to CO
- **5.1** Automatically manage leave and attendance workflows between E and CO.

## 5. User Experience

As a CO and E I want to be able to:

- **5.1** Interact with the system via my WhatsApp number / account

---

## 6. Security and Confidentiality

> Added after the original brief. Sections 1–5 above are the brief as written;
> this section is a later addition, numbered from 6 so nothing above it moves.
> The design that answers these stories is in [security.md](./security.md).

The driver: an owner is being asked to put pay rates, addresses and eventually
bank details into a chat thread, and will reasonably ask who else can see it.
Phase 1 has to have a true answer.

As a CO I want to be able to:

- **6.1** Know exactly who can see my employees' data, and be told plainly that
  Meta processes WhatsApp messages in transit — before I ask
- **6.2** Trust that pay rates and personal details are encrypted in transit and
  at rest, not merely "in the cloud"
- **6.3** Provide genuinely sensitive data (bank details, government
  identifiers, ID photos) without typing it into a chat message
- **6.4** Mark any field I create as confidential, and have that respected
  everywhere it is stored, logged or displayed
- **6.5** Be confident an employee cannot see another employee's record
- **6.6** Have chat transcripts not retained indefinitely

As an E I want to be able to:

- **6.7** Know my personal details are not visible to colleagues, and that my
  own messages aren't kept forever
- **6.8** Share a document or identifier with my employer without it sitting in
  a chat history

As a S I want to be able to:

- **6.9** Encrypt fields classified confidential before they reach the database,
  under keys scoped per account
- **6.10** Reject any inbound webhook whose signature does not verify, with no
  fallback that accepts unsigned requests
- **6.11** Never write message bodies or field values to logs
- **6.12** Send only the minimum necessary data to the LLM provider, and never
  send restricted values at all
- **6.13** Detect and redact sensitive values a user pastes into chat anyway
- **6.14** Scope every query by account, so no bug can return another business's
  data
- **6.15** Require an authenticated session for any non-chat surface
