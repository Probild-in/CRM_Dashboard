# Roadmap

Each phase ships end to end — database, API, validation, authorisation,
frontend, tests, docs — before the next one starts.

## Phase 1 — Foundation ✅

Monorepo, Postgres schema for all 24 tables, authentication with refresh
rotation, role-based authorisation, users and team management, audit log,
centralised error handling, and the frontend shell.

**Shipped:** `/api/auth`, `/api/users`, `/api/audit`, `/api/health`;
Sign in, Dashboard shell, Team, Audit log, Settings.

## Phase 2 — CRM ✅

Leads and the sales pipeline. Capture with source, priority, expected value in
INR or USD, and a next follow-up date. The drag-and-drop board runs New →
Contacted → Qualified → Meeting → Proposal → Negotiation → Won/Lost. Every lead
carries a timeline that mixes logged calls, emails, meetings and notes with the
system's own record of stage moves, value changes, reassignments and follow-up
scheduling. Global search covers leads and people, filters cover stage,
priority, source, owner and follow-up state.

Two rules worth naming:

- **Leads are visible to the whole sales team.** Sales and super admins see the
  full pipeline; everyone else sees only what is assigned to them.
- **Follow-up reminders go to the assigned owner.** Ownership is what the
  Phase 7 engine will address its reminders to.

**Shipped:** `/api/leads`, `/api/leads/pipeline`, `/api/leads/summary`,
`/api/leads/:id/status`, `/api/leads/:id/assign`, `/api/leads/:id/activities`,
`/api/services`, `/api/search`; Leads, Lead detail, Pipeline board, global search.

## Phase 3 — Sales ✅

Deals, quotations, conversion and clients.

A quotation is built from line items with per-line discounts, a quotation-level
discount and tax, and walks DRAFT → SENT → VIEWED → NEGOTIATION →
ACCEPTED/REJECTED/EXPIRED. **Totals are computed on the server and nowhere
else** — the client sends quantities and prices, never a total.

Every figure a quotation or deal has ever carried is kept in `pricing_history`
with the reason, the person and the timestamp. Nothing about money is
overwritten in place.

Converting a won lead creates the client, carries its details and named contact
across, opens a won deal for the agreed value, and links the lead rather than
replacing it — the pipeline history is how the client was won. It runs in one
transaction, so a half-converted lead cannot exist.

Two automations that follow from "enter it once":

- **Accepting a quotation wins the deal behind it** and sets the deal's value to
  the agreed figure. Both are written to the audit trail.
- **Converting a lead clears its follow-up** and locks it against further edits;
  the client record takes over.

**Shipped:** `/api/clients` (+ `/overview`, `/contacts`), `/api/deals`
(+ `/stage`, `/pricing-history`), `/api/quotations` (+ `/status`,
`/pricing-history`), `/api/leads/:id/convert`; Clients, the 360° client profile,
Quotations, the quotation builder and the negotiation trail.

## Phase 4 — Project management ✅

Projects, milestones, tasks and the team on each.

A project runs PLANNING → ACTIVE → ON_HOLD → IN_REVIEW → CLIENT_REVIEW →
COMPLETED/CANCELLED, carries its client, value, dates and services, and lists
who is working on it. Tasks take a due *instant*, an owner, an estimate and a
discussion thread.

Three rules the module is built around:

- **Lateness is derived, never a status.** `isOverdue` is computed on every read
  from `due_at` against now. A late task still reports `IN_PROGRESS` or
  `BLOCKED` — writing an `OVERDUE` status would destroy the one fact that says
  what the person is actually doing. There is deliberately no such status to
  write, and a request that tries answers `400`.
- **Project progress follows its milestones.** Completion is the average across
  the milestones that still count; cancelled ones are excluded rather than
  dragging the number down. A project with no milestones keeps whatever
  progress was set by hand.
- **Marking a milestone complete sets it to 100%,** and completing a project
  sets its progress to 100% — the number and the status never disagree.

Visibility follows the same shape as leads: project managers and super admins
see everything in delivery; everyone else sees the projects they manage or are
a member of, and the tasks assigned to them plus anything on those projects.

**Shipped:** `/api/projects` (+ `/summary`, `/status`, `/members`,
`/milestones`), `/api/tasks` (+ `/summary`, `/status`, `/assign`, `/comments`);
Projects, the project workspace with milestones, tasks and team, and the Tasks
screen with its own quick filters. The client profile's Projects and Tasks tabs
now carry real data.

## Phase 5 — Dashboard ✅

The question the whole product exists to answer — *what needs me today?* — with
real numbers behind it.

Eight KPI tiles across the top, then three tabs: **Your day** (today, overdue,
next seven days, each item a link into the record), **Sales** (pipeline by
stage, where leads come from with their conversion rate, and won-versus-received
over six months) and **Delivery** (projects by status, tasks by status, delayed
projects, and open tasks per person).

Three things worth naming:

- **"Today" is the reader's today.** Day and month boundaries are computed in
  the signed-in user's timezone, not UTC — a follow-up at 09:00 in Kolkata is
  not today in UTC, and the two disagree for five and a half hours every day.
  `apps/api/src/lib/time.ts` does that conversion and is tested against
  Asia/Kolkata, UTC and a DST-observing zone.
- **Conversion is won out of *decided* leads**, not out of all of them. Counting
  open leads as losses makes a healthy pipeline look like a failing one.
- **Money is shown one currency at a time.** The sales tab carries a currency
  selector rather than summing INR and USD into a meaningless figure.

Every section is scoped by the same visibility rules as its module, so an
employee's dashboard shows their work and a manager's shows the department's.

**Shipped:** `/api/dashboard`, `/api/dashboard/sales`, `/api/dashboard/delivery`;
the dashboard with its KPI row, agenda columns and charts.

## Phase 6 — Google integration ✅

Meetings, a calendar, and Google.

Meetings attach to a lead, a client or a project, carry attendees from inside
and outside Probild, and record an outcome when they are held. The calendar
shows meetings, task deadlines and project delivery dates on one grid, in month,
week or agenda view.

Google Calendar is layered on top rather than built in:

- **The integration is optional.** Meetings work fully without it. Until someone
  adds the credentials, the Settings panel says so and names the three variables.
- **Sync is best-effort.** A Google outage never stops someone booking a meeting
  — the push is attempted, failures are logged, and the local record stands.
  There is a test that mocks a network failure and asserts the meeting is still
  created.
- **Tokens never leave the server.** Refresh tokens are encrypted with
  AES-256-GCM before storage; the client only ever learns that a connection
  exists. The OAuth `state` is HMAC-signed so another account cannot claim a
  callback.
- **Each person chooses what is mirrored** — meetings they organise, and
  optionally their task deadlines as a 30-minute marker before each due time.

Two automations that follow from "enter it once": booking a meeting with a lead
writes to that lead's timeline, and marking one held moves the lead's
last-contacted date and records the outcome there.

**Shipped:** `/api/meetings` (+ `/calendar`, `/status`), `/api/calendar`
(connection, connect, callback, sync, task mirroring); the Calendar screen, the
meeting form and detail, and the Google panel in Settings.

## Phase 7 — Automation engine ✅

The subsystem the rest of the product exists to feed. A BullMQ worker scans
every five minutes, asks what has a deadline, and raises reminders — once.

**The sequence from the brief**, for a task due 22 August at 5:00 PM:

| When | What is said |
| --- | --- |
| 21 Aug | Task due tomorrow |
| 22 Aug, morning | Task due today |
| 22 Aug, 3:00 PM | Task due in two hours |
| 22 Aug, 5:00 PM | Task due now |
| after 5:00 PM | Task overdue |

Each of those is a test.

**Idempotency is enforced by the database, not by a check.** Every reminder has
a `dedupe_key` of `entity:id:rule:deadline`, and `automation_executions` holds a
unique index on it. The engine *inserts first* — two workers racing both try to
write the same key, exactly one wins, and the loser gets P2002 and stands down.
A read-then-write would let both send. There is a test that runs three scans
concurrently and asserts one notification.

Three more rules the engine follows:

- **One reminder speaks at a time.** A task created an hour before its deadline
  has four ripe rules at once; the most urgent is announced and the rest are
  recorded silently so they can never surface later as if they were news.
- **The deadline is part of the key.** Move a task's due date and its reminders
  legitimately fire again for the new date — but nothing repeats for a date
  already announced.
- **Deadlines older than 30 days are ignored**, so a first deployment does not
  blast the team about everything ever missed.

Rules differ by record, because the records differ: a meeting is never
"overdue" — it happened or it did not — and a quotation *expires*, which also
moves its status rather than only mentioning it.

Reminders go to the owner: the task's assignee, the lead's owner, the project's
manager, the payment's account manager — and, for a meeting, everyone expected
in the room.

**Shipped:** `/api/notifications` (+ unread count, mark read, mark all read),
`/api/automation` (status, executions ledger, manual run); the worker process,
the notification centre in the top bar, and the Notifications screen.

## Phase 8 — Payments and reports ✅

The money side, and the numbers to take into a review.

**Payments** are raised against a client — optionally against a project — with
an amount, a currency and a due date. Receipts are **additive**: a part payment
followed by the balance leaves both on the record, and the status follows from
the arithmetic rather than being chosen. Everything rounds to two decimals, so
three receipts of 33.33, 33.33 and 33.34 settle 100 exactly.

Guard rails that matter with money:

- A receipt larger than what is outstanding is refused, with the figure named.
- The amount cannot be set below what has already arrived.
- Raising the amount on a settled invoice unsettles it — outstanding is a
  calculation, not a flag.
- A payment with money against it cannot be cancelled or deleted; the amount is
  adjusted instead, and the change is written to the pricing trail.
- **Lateness is derived**, as everywhere else. A late payment keeps its
  settlement status — PENDING or PARTIALLY_PAID — and reports `isOverdue`
  alongside it.

**Outstanding** answers the brief's formula directly: the project position
endpoint reports value, billed, received, outstanding *and unbilled* — the part
of a project's value that has not been invoiced yet.

**Reports** cover revenue (by month, client and service), sales (conversion by
owner and source), delivery (measured against the date that was promised, with
an on-time rate and average days late) and outstanding (aged by how late the
money is, worst client first). Every table exports to CSV, with a byte-order
mark so Excel reads ₹ correctly.

**Shipped:** `/api/payments` (+ `/summary`, `/receipts`, `/cancel`, project
position), `/api/reports` (revenue, sales, projects, outstanding); the Payments
screen with its ageing chart, and the four-tab Reports screen.

With this phase every module in the sidebar is real — the placeholder route and
its "arriving in phase N" copy have been removed.

## Documents and sending ✅

Added after Phase 8, at request.

Agreements, quotations, invoices and anything else a client needs live against
the client and can be emailed from Probild with the file attached. Quotations
and invoices are **generated** as PDFs from records already held; agreements and
signed papers are uploaded. Both appear on the client's Documents tab, alongside
who received what and when.

- **Sending is optional**, like the calendar: with no SMTP host configured,
  documents are still stored, generated and downloadable, and the app says so.
- **A failed send is recorded, not lost.** A bounced address shows on the client
  profile rather than disappearing into a log.
- **Regenerating replaces the file** rather than piling up copies — the document
  is the current state of the quotation, and its send history survives.
- **Generated PDFs use ISO currency codes** (`INR 6,84,400.00`). PDFKit's
  built-in font has no ₹ glyph, so a symbol would print as a stray mark; the
  code needs no embedded font and reads unambiguously in either country. Digit
  grouping still follows the currency's own convention.

**A Documents section in the sidebar** is the library: pick a client, tick the
papers, send them together. One email carries them all — a client receiving an
agreement and its invoice should get one message, not two — and the recipient
defaults to that client's primary contact.

Two refusals worth naming: a selection spanning two clients has no single
recipient, so it is blocked rather than sent to one of them; and a batch over
20MB is refused before the send, because most inboxes would bounce it after.

**Shipped:** `/api/documents` (list, upload, generate, download, send one, send
many, delete); the Documents screen with client filter and multi-select, the
Documents tab on the client profile, send actions on quotations and payments,
and the send dialog with an editable covering note.

## Phase 9 — Production hardening

Security review, performance and index tuning, structured logging and alerting,
backup and restore procedure, deployment, operator documentation.

The database, authentication and file storage now run on Supabase, which covers
managed Postgres, backups and the credential store. What remains in this phase
is hosting the API, worker and web client, alerting, and the operator runbook.
See `docs/DEPLOYMENT.md`.

---

## Later, once the core is proven

The architecture leaves room for these; none are being built now. Each attaches
as its own service alongside `GoogleCalendarService`:

Gmail · WhatsApp · Slack · Stripe · Razorpay · QuickBooks · Xero · Apollo ·
Clay · AI sales assistant · AI follow-up drafting · client portal · invoice
generation.
