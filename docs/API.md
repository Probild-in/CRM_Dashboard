# API reference — Phases 1–8

Base URL `http://localhost:4000/api`. Every response uses the envelope described
in [ARCHITECTURE.md](ARCHITECTURE.md#response-envelope).

Authenticated routes need `Authorization: Bearer <accessToken>`.

## Auth

| Method | Path                    | Permission | Description |
| ------ | ----------------------- | ---------- | ----------- |
| POST   | `/auth/login`           | —          | Returns the session and sets the refresh cookie. Rate limited to 10 per 15 min. |
| POST   | `/auth/refresh`         | cookie     | Rotates the refresh token and returns a new access token. |
| POST   | `/auth/logout`          | —          | Revokes the presented refresh token. |
| GET    | `/auth/me`              | signed in  | The caller and their permissions. |
| POST   | `/auth/change-password` | signed in  | Changes the password and signs the user out everywhere. |

## Users

| Method | Path                        | Permission     | Description |
| ------ | --------------------------- | -------------- | ----------- |
| GET    | `/users`                    | `user:read`    | Paginated, filterable by role, status and search. |
| GET    | `/users/:id`                | `user:read`    | One user. |
| POST   | `/users`                    | `user:write`   | Creates a team member. |
| PATCH  | `/users/:id`                | `user:write`   | Updates one. Refuses to demote the last active super admin. |
| PATCH  | `/users/me`                 | signed in      | Updates your own profile. |
| POST   | `/users/:id/reset-password` | `user:write`   | Sets a new password and revokes their sessions. |
| DELETE | `/users/:id`                | `user:delete`  | Soft delete. Refuses self-deactivation and the last super admin. |

## Leads

| Method | Path                      | Permission     | Description |
| ------ | ------------------------- | -------------- | ----------- |
| GET    | `/leads`                  | `lead:read`    | Paginated and filterable. See the filters below. |
| GET    | `/leads/summary`          | `lead:read`    | Counts for the header: total, open, follow-up overdue, unassigned, by priority. |
| GET    | `/leads/pipeline`         | `lead:read`    | Board data: one entry per open stage with count and per-currency value, plus won and lost totals. |
| GET    | `/leads/:id`              | `lead:read`    | One lead. |
| POST   | `/leads`                  | `lead:write`   | Creates a lead and its `LEAD-000000` reference. Defaults the owner to the caller. |
| PATCH  | `/leads/:id`              | `lead:write`   | Updates fields. Rejects a `status` change — use the status action. |
| POST   | `/leads/:id/status`       | `lead:write`   | Moves the stage. `lostReason` is required for `LOST`. |
| POST   | `/leads/:id/assign`       | `lead:assign`  | Reassigns, or clears the owner with `null`. |
| GET    | `/leads/:id/activities`   | `lead:read`    | The timeline, newest first. |
| POST   | `/leads/:id/activities`   | `lead:write`   | Logs a call, email, meeting, WhatsApp message or note, and optionally sets the next follow-up. |
| DELETE | `/leads/:id`              | `lead:delete`  | Soft delete. |

**Visibility.** A caller holding `lead:read:all` (sales, super admin) sees every
lead. Everyone else sees only leads assigned to them, and a lead outside that
scope answers `404` rather than `403` — the existence of a record is itself
information.

**Filters on `GET /leads`:** `status`, `priority`, `source`, `currency`,
`assignedToId`, `interestedServiceId`, `unassigned`, `openOnly`,
`followUpOverdue`, `followUpThisWeek`, `closeFrom`, `closeTo`, plus the shared
`search`, `page`, `pageSize`, `sortBy` and `sortOrder`.

**Derived fields.** `isFollowUpOverdue` is computed per request from
`nextFollowUpAt` against now, and is always `false` for a won or lost lead.
Nothing writes it to the database.

## Dashboard

| Method | Path                    | Permission                       | Description |
| ------ | ----------------------- | -------------------------------- | ----------- |
| GET    | `/dashboard`            | `dashboard:read`                 | KPIs, today's agenda, what is overdue, and the next seven days. |
| GET    | `/dashboard/sales`      | `dashboard:read` + `lead:read`   | Pipeline by stage, conversion, lead sources, and won/received by month. `?months=` 3–24, default 6. |
| GET    | `/dashboard/delivery`   | `dashboard:read` + `project:read`| Projects and tasks by status, average completion, delayed projects, open tasks per person. |

**Timezone.** Day and month boundaries come from the signed-in user's `timezone`,
not from UTC. `dayRange`, `monthRange` and `recentMonths` in
`apps/api/src/lib/time.ts` convert a zone name into the UTC instants that bound a
local day or month.

**Money** in every response is keyed by currency (`{ "INR": 150000, "USD": 2000 }`)
and never summed across currencies.

**Scoping.** Each section reuses its own module's visibility rule, so the numbers
a person sees match the records they can open.

## Clients

| Method | Path                             | Permission      | Description |
| ------ | -------------------------------- | --------------- | ----------- |
| GET    | `/clients`                       | `client:read`   | Paginated; filter by status, account manager, currency, search. |
| GET    | `/clients/:id`                   | `client:read`   | One client. |
| GET    | `/clients/:id/overview`          | `client:read`   | The 360° view: contacts, deals, quotations, projects, tasks, meetings, payments, documents, origin leads, activity and headline stats. |
| POST   | `/clients`                       | `client:write`  | Creates a client and its `CLT-000000` reference. |
| PATCH  | `/clients/:id`                   | `client:write`  | Updates one. |
| DELETE | `/clients/:id`                   | `client:delete` | Soft delete. Refused while projects or payments are attached. |
| GET    | `/clients/:id/contacts`          | `client:read`   | People at that company. |
| POST   | `/clients/:id/contacts`          | `client:write`  | Adds one. Marking it primary demotes the others. |
| PATCH  | `/clients/:id/contacts/:contactId` | `client:write` | Updates one. |
| DELETE | `/clients/:id/contacts/:contactId` | `client:write` | Soft delete. |

Money in the overview's `stats` is keyed by currency (`{ "INR": 150000, "USD": 2000 }`)
and never summed across currencies.

## Conversion

| Method | Path                  | Permission                      | Description |
| ------ | --------------------- | ------------------------------- | ----------- |
| POST   | `/leads/:id/convert`  | `lead:convert` + `client:write` | Turns a won lead into a client, carries its contact across, optionally opens a won deal, and links the lead. |

Refused with `422` unless the lead is `WON`, and with `409` if it has already
been converted. The lead is kept — deleting it would erase how the client was won.

## Deals

| Method | Path                        | Permission    | Description |
| ------ | --------------------------- | ------------- | ----------- |
| GET    | `/deals`                    | `deal:read`   | Paginated; filter by stage, client, lead, owner, currency. |
| GET    | `/deals/:id`                | `deal:read`   | One deal. |
| POST   | `/deals`                    | `deal:write`  | Needs a client or a lead to hang off. |
| PATCH  | `/deals/:id`                | `deal:write`  | A `value` change writes to the pricing trail; pass `valueChangeReason`. |
| POST   | `/deals/:id/stage`          | `deal:write`  | OPEN / NEGOTIATION / WON / LOST. `lostReason` required for LOST. |
| GET    | `/deals/:id/pricing-history`| `deal:read`   | Append-only value trail. |
| DELETE | `/deals/:id`                | `deal:delete` | Soft delete. |

## Quotations

| Method | Path                             | Permission         | Description |
| ------ | -------------------------------- | ------------------ | ----------- |
| GET    | `/quotations`                    | `quotation:read`   | Paginated; filter by status, client, lead, deal, currency, `expiringSoon`. |
| GET    | `/quotations/:id`                | `quotation:read`   | One quotation with its line items. |
| POST   | `/quotations`                    | `quotation:write`  | Needs at least one line item and a client or lead. |
| PATCH  | `/quotations/:id`                | `quotation:write`  | Replaces line items wholesale and recomputes. Refused once accepted or rejected. |
| POST   | `/quotations/:id/status`         | `quotation:write`  | Moves through the lifecycle; invalid moves answer `422`. |
| GET    | `/quotations/:id/pricing-history`| `quotation:read`   | Every total the quotation has carried. |
| DELETE | `/quotations/:id`                | `quotation:delete` | Soft delete. Refused for an accepted quotation. |

**Totals are server-side.** Any `subtotal`, `taxAmount` or `total` in a request
body is ignored. The calculation, in order:

```
lineTotal   = round2(quantity × unitPrice × (1 − lineDiscount%/100))
subtotal    = round2(Σ lineTotal)
discount    = clamp(discountAmount, 0, subtotal)
taxAmount   = round2((subtotal − discount) × taxPercent/100)
total       = round2(subtotal − discount + taxAmount)
```

Every step rounds to two decimals so the printed lines always add up.

**Allowed transitions:** DRAFT→SENT · SENT→VIEWED/NEGOTIATION/ACCEPTED/REJECTED/EXPIRED ·
VIEWED→NEGOTIATION/ACCEPTED/REJECTED/EXPIRED · NEGOTIATION→SENT/ACCEPTED/REJECTED/EXPIRED ·
EXPIRED→NEGOTIATION. ACCEPTED and REJECTED are terminal.

`isExpired` is derived per request from `validUntil`, and is always `false` once
a quotation is decided.

## Projects

| Method | Path                                    | Permission        | Description |
| ------ | --------------------------------------- | ----------------- | ----------- |
| GET    | `/projects`                             | `project:read`    | Paginated; filter by status, priority, client, manager, member, `overdue`, `dueSoon`, `activeOnly`. |
| GET    | `/projects/summary`                     | `project:read`    | Counts: total, active, overdue, due soon, completed. |
| GET    | `/projects/:id`                         | `project:read`    | One project with team, services and counts. |
| POST   | `/projects`                             | `project:write`   | Creates it and its `PRJ-000000` reference. The manager joins the team automatically. |
| PATCH  | `/projects/:id`                         | `project:write`   | A `value` change writes to the pricing trail; pass `valueChangeReason`. |
| POST   | `/projects/:id/status`                  | `project:write`   | Moves the status. Completing sets progress to 100%. |
| POST   | `/projects/:id/members`                 | `project:write`   | Adds someone. `409` if already on it. |
| DELETE | `/projects/:id/members/:userId`         | `project:write`   | Removes someone. The manager cannot be removed. |
| GET    | `/projects/:id/milestones`              | `project:read`    | Stages in order, each with `isOverdue`. |
| POST   | `/projects/:id/milestones`              | `milestone:write` | Appends a stage and recomputes progress. |
| PATCH  | `/projects/:id/milestones/:milestoneId` | `milestone:write` | Updates it and recomputes progress. |
| DELETE | `/projects/:id/milestones/:milestoneId` | `milestone:write` | Refused while the milestone still has tasks. |
| DELETE | `/projects/:id`                         | `project:delete`  | Soft delete. Its tasks are hidden with it. |

**Visibility.** `project:read:all` (project manager, super admin) sees every
project. Everyone else sees the ones they manage or are a member of; anything
else answers `404`.

**Progress** is `round(average(completionPercent))` across milestones that are
not cancelled, recalculated whenever a milestone is added, changed or removed.
With no milestones, the stored value is left alone.

## Tasks

| Method | Path                    | Permission     | Description |
| ------ | ----------------------- | -------------- | ----------- |
| GET    | `/tasks`                | `task:read`    | Paginated; filter by status, priority, project, milestone, client, assignee, `overdue`, `dueToday`, `dueThisWeek`, `openOnly`, `unassigned`. Tasks with no deadline sort last. |
| GET    | `/tasks/summary`        | `task:read`    | Counts: total, open, overdue, due today, unassigned, and breakdowns by status and priority. |
| GET    | `/tasks/:id`            | `task:read`    | One task. |
| POST   | `/tasks`                | `task:write`   | Creates it and its `TSK-000000` reference. A task on a project inherits that project's client. |
| PATCH  | `/tasks/:id`            | `task:write`   | Updates fields. A milestone must belong to the task's project. |
| POST   | `/tasks/:id/status`     | `task:write`   | TODO / IN_PROGRESS / REVIEW / BLOCKED / COMPLETED / CANCELLED. Accepts `actualHours`. |
| POST   | `/tasks/:id/assign`     | `task:assign`  | Reassigns, or clears with `null`. |
| GET    | `/tasks/:id/comments`   | `task:read`    | The discussion, oldest first. |
| POST   | `/tasks/:id/comments`   | `task:write`   | Adds a comment. |
| DELETE | `/tasks/:id`            | `task:delete`  | Soft delete. |

**Derived fields.** `isOverdue`, `isDueToday` and `hoursUntilDue` are computed
per request from `due_at`, and are never stored. `isOverdue` is always `false`
for a completed or cancelled task. **There is no `OVERDUE` status** — posting
one answers `400`.

**Visibility.** `task:read:all` (project manager, super admin) sees all work.
Everyone else sees tasks assigned to them, tasks they created, and anything on
a project they are a member of.

## Payments

| Method | Path                                    | Permission        | Description |
| ------ | --------------------------------------- | ----------------- | ----------- |
| GET    | `/payments`                             | `payment:read`    | Paginated; filter by status, client, project, currency, `overdue`, `outstandingOnly`, due-date range. |
| GET    | `/payments/summary`                     | `payment:read`    | Billed, received, outstanding and overdue per currency, plus an ageing breakdown. |
| GET    | `/payments/projects/:projectId/position`| `payment:read`    | A project's value, billed, received, outstanding and unbilled. |
| GET    | `/payments/:id`                         | `payment:read`    | One payment. |
| POST   | `/payments`                             | `payment:write`   | Raises one. A project must belong to the same client. |
| PATCH  | `/payments/:id`                         | `payment:write`   | Changing the amount writes to the pricing trail; pass `amountChangeReason`. |
| POST   | `/payments/:id/receipts`                | `payment:write`   | Records money arriving. Additive. |
| POST   | `/payments/:id/cancel`                  | `payment:write`   | Refused once money has arrived. |
| DELETE | `/payments/:id`                         | `payment:delete`  | Soft delete; refused once money has arrived. |

**Settlement follows the arithmetic.** `PENDING` with nothing received,
`PARTIALLY_PAID` in between, `PAID` once received ≥ billed. Nothing writes
`OVERDUE` — `isOverdue` is derived per request from the due date, exactly as it
is for tasks and projects.

**Outstanding** is `amount − paidAmount`, rounded to two decimals. Every total
is keyed by currency and never summed across them.

## Reports

| Method | Path                     | Permission    | Description |
| ------ | ------------------------ | ------------- | ----------- |
| GET    | `/reports/revenue`       | `report:read` | Received and won by month, by client and by service. `?months=` 1–36, default 12. |
| GET    | `/reports/sales`         | `report:read` | Conversion overall, by owner and by source, plus leads created and won by month. |
| GET    | `/reports/projects`      | `report:read` | Delivery against the promised date: on-time rate, average days late, slipping projects. |
| GET    | `/reports/outstanding`   | `report:read` | Everything still owed, grouped by client and listed in full, aged by days late. |

Month windows are bounded by the reader's timezone, so a report run from Mumbai
and one run from London agree about which month a payment landed in.

**On-time** means delivered on or before the date that was promised. With
nothing delivered yet the rate is `null` and renders as "—", not 0%.

## Documents

| Method | Path                       | Permission         | Description |
| ------ | -------------------------- | ------------------ | ----------- |
| GET    | `/documents`               | `document:read`    | Filter by client, project, entity or kind. |
| GET    | `/documents/mail-status`   | `document:read`    | Whether email is configured, so the UI can say so up front. |
| GET    | `/documents/:id`           | `document:read`    | One document with its full send history. |
| GET    | `/documents/:id/download`  | `document:read`    | The file. `private, no-store`, never cached. |
| POST   | `/documents/upload`        | `document:write`   | Multipart, one file, field name `file`, with `kind`, `clientId`/`projectId`. |
| POST   | `/documents/generate`      | `document:write`   | Produces a PDF from a `QUOTATION` or `PAYMENT`. Regenerating replaces the file and keeps the send history. |
| POST   | `/documents/send`          | `document:write`   | Emails 1–10 documents to one client as a **single** message. `503` if email is not configured, `502` if it bounced, `422` if the attachments exceed 20MB. |
| POST   | `/documents/:id/send`      | `document:write`   | The same, for exactly one document. |
| DELETE | `/documents/:id`           | `document:delete`  | Soft delete; the stored file is removed. |

**Upload safety.** Files are held in memory, checked against an allow-list of
MIME types and a size cap, then written under a generated UUID name — the
browser-supplied filename is kept only as a display label and is stripped before
it reaches a `Content-Disposition` header. `resolveStorageKey` refuses any key
that resolves outside the storage root, so `../../.env` cannot be read.

**The storage key never leaves the server.** It is deliberately absent from the
document shape the API returns.

**Every send is recorded** in `document_sends` — recipient, subject, who sent
it, and the error if it failed. A batch writes one row per document, so each
document's own history shows it. A bounce is a business fact the account manager
needs on the client profile, not a line in a log.

## Notifications

| Method | Path                          | Permission | Description |
| ------ | ----------------------------- | ---------- | ----------- |
| GET    | `/notifications`              | signed in  | The caller's own, newest first. `unreadOnly`, `type`, plus paging. |
| GET    | `/notifications/unread-count` | signed in  | The badge number. |
| POST   | `/notifications/:id/read`     | signed in  | Marks one read. |
| POST   | `/notifications/read-all`     | signed in  | Marks everything read. |

Notifications are personal — every query is scoped to the caller, and there is
no endpoint that returns anybody else's.

## Automation

| Method | Path                       | Permission       | Description |
| ------ | -------------------------- | ---------------- | ----------- |
| GET    | `/automation/status`       | `settings:read`  | The schedule, whether the worker can reach Redis, and the last execution. |
| GET    | `/automation/executions`   | `audit:read`     | The idempotency ledger — every reminder ever raised, filterable by entity. |
| POST   | `/automation/run`          | super admin      | Runs a scan in-process, now. |

`POST /automation/run` exists so an administrator can prove the engine works
without waiting five minutes, and so the system is usable when Redis is not
running. The scheduled worker is the normal path.

**The scan window.** Deadlines from 30 days back to 4 days ahead. The lookback
means a restart after downtime still catches what went late; the cap means a
first deployment does not raise reminders about years-old records.

**Rules by record.**

| Record | Rules |
| --- | --- |
| Task | due tomorrow · due today · due in 2 hours · due now · overdue |
| Lead follow-up | due tomorrow · due today · overdue |
| Meeting | due tomorrow · due in 2 hours |
| Milestone | due in 3 days · due tomorrow · overdue |
| Project | due in 3 days · due tomorrow · overdue |
| Payment | due in 3 days · due today · overdue |
| Quotation | due in 3 days · expired *(also sets the status)* |

"Tomorrow" and "today" are calendar words, answered on the recipient's wall
clock; "in two hours" is arithmetic on the deadline.

## Meetings

| Method | Path                       | Permission        | Description |
| ------ | -------------------------- | ----------------- | ----------- |
| GET    | `/meetings/calendar`       | `meeting:read`    | Everything with a date in a window: meetings, task deadlines and project deliveries. Needs `from` and `to`. |
| GET    | `/meetings`                | `meeting:read`    | Paginated; filter by status, lead, client, project, organiser, date range, `upcoming`. |
| GET    | `/meetings/:id`            | `meeting:read`    | One meeting with attendees and any mirrored Google event. |
| POST   | `/meetings`                | `meeting:write`   | Must end after it starts, and must attach to a lead, client or project. |
| PATCH  | `/meetings/:id`            | `meeting:write`   | Updates it and re-pushes to Google. |
| POST   | `/meetings/:id/status`     | `meeting:write`   | SCHEDULED / COMPLETED / CANCELLED / NO_SHOW. `outcome` is required for COMPLETED. |
| DELETE | `/meetings/:id`            | `meeting:delete`  | Soft delete; the Google event is removed too. |

**Derived fields.** `needsOutcome` is true for a meeting still marked scheduled
whose end time has passed. `isSynced` says whether a Google event mirrors it.

**Side effects.** A meeting against a lead is written to that lead's timeline;
marking one held moves the lead's `lastContactedAt` and records the outcome.

## Calendar and Google

| Method | Path                              | Permission    | Description |
| ------ | --------------------------------- | ------------- | ----------- |
| GET    | `/calendar/connection`            | signed in     | `{ configured, connection }` — whether the credentials exist, and the caller's connection. |
| POST   | `/calendar/google/connect`        | signed in     | Returns the consent URL. `503` until the credentials are set. |
| GET    | `/calendar/google/callback`       | signed state  | Google's redirect target. Authenticated by the HMAC-signed `state`, not a bearer token; redirects back to `/settings`. |
| PATCH  | `/calendar/connection`            | signed in     | `syncMeetings` and `syncTasks`. |
| DELETE | `/calendar/connection`            | signed in     | Revokes the token at Google and deactivates the connection. |
| POST   | `/calendar/sync`                  | signed in     | Pulls changes from Google into the meetings it already owns. |
| POST   | `/calendar/tasks/:taskId`         | `task:write`  | Mirrors one task deadline onto the assignee's calendar. |

**Optional by design.** Every meeting endpoint works with Google unconfigured.
When it is configured, pushes are best-effort: failures are logged and never
propagate to the caller.

**Token handling.** Access and refresh tokens are encrypted (AES-256-GCM) before
storage and are never included in any response. Access tokens refresh
automatically a minute before expiry.

## Services

| Method | Path         | Permission | Description |
| ------ | ------------ | ---------- | ----------- |
| GET    | `/services`  | signed in  | The service catalogue. `?includeInactive=true` returns retired entries too. |

## Search

| Method | Path      | Permission | Description |
| ------ | --------- | ---------- | ----------- |
| GET    | `/search` | signed in  | `?q=` needs two characters. Returns leads and team members the caller may read, each with a `url` to open. |

## Audit

| Method | Path     | Permission   | Description |
| ------ | -------- | ------------ | ----------- |
| GET    | `/audit` | `audit:read` | Filterable by action, entity type, entity, user and date range. |

## Health

| Method | Path             | Description |
| ------ | ---------------- | ----------- |
| GET    | `/health`        | Liveness. |
| GET    | `/health/ready`  | Readiness — checks the database answers. |

## Pagination

All list endpoints accept `page`, `pageSize` (max 100), `sortBy`, `sortOrder`
and `search`. `sortBy` is matched against an allowlist per endpoint; anything
else falls back to the default column.

## Error codes

`VALIDATION_ERROR` · `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` ·
`RATE_LIMITED` · `UNPROCESSABLE` · `INTERNAL_ERROR`
