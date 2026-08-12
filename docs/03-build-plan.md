# 03 — Build Plan

**How we work:** one module at a time. Each module ships its backend, its
frontend, and its tests together, and is demonstrable before the next begins.
No module is "done" because the API exists — it is done when you can use it in a
browser.

---

## Definition of done

A module is finished when **all** of these are true:

- [ ] Backend endpoints written, with validation and permission checks
- [ ] Frontend screens built, in all five languages
- [ ] Loading, empty and error states handled — not just the happy path
- [ ] Integration tests on the API for the permission rules
- [ ] Works end to end in the browser, checked in English **and** Arabic
- [ ] Demonstrable: you can watch someone do the thing

That last one is the real gate. If it cannot be shown, it is not done.

---

## Module order

Each module is sized to be reviewable. The order is dependency-driven — nothing
depends on something built later.

### M0 — Foundation

*No user-visible feature. The scaffolding everything else sits on.*

- Two repos, TypeScript, Prisma, Postgres, Docker Compose for local dev
- Database schema and first migration
- Auth: register, login, logout, refresh, password hashing
- **Password reset** — single-use token, 1-hour expiry, email delivery
- Role middleware and the permission table from the design doc
- Error envelope, request logging, health endpoint
- Frontend shell: routing, design tokens, five locales, RTL, login screen
- Seed script with three users, one per role

**Demo:** log in as each of the three roles and see a different (empty) shell.

---

### M1 — Projects

- Create, edit, archive a project — a **three-step wizard**
  1. Details: name, key (`WEB`), description, client
  2. Team: add PMs and developers
  3. **What the client sees** — preset + toggles → [`04-client-visibility.md`](04-client-visibility.md)
- **Invitations:** invite by email, accept, set password, join the project
- Add and remove members, with roles
- Project switcher; project home
- Permission: only a PM creates projects and manages members

**Demo:** a PM creates a project, invites a developer and a client by email.
Both accept from their inbox, set a password, and see the project.

> Invitations are in M1 rather than later because without them this module
> cannot be demonstrated — there is no way to add a person who has no account.

---

### M2 — Tasks *(the core)*

The biggest module. Everything after it is an addition.

- Create task: title, description, type, priority, assignee, due date, estimate
- Task key generation (`WEB-142`)
- **Markdown** descriptions, rendered sanitised, with a small toolbar
- Task detail screen
- List view with filters: assignee, status, priority, due date, text search
- Edit and archive
- Permissions: PM creates and assigns; a developer edits only their own

**Demo:** a PM creates and assigns a task. The developer sees it. The client sees
it. Nobody can do what they should not.

---

### M3 — Board and status workflow

- Kanban board, five columns, drag to change status
- Transition rules enforced server-side (`IN_REVIEW → DONE` is PM-only)
- `BLOCKED` requires a reason
- **Task dependencies** — one link type, `BLOCKS`, with a cycle check on write
- Activity history on every task

**Demo:** drag a task across the board. Try the moves you are not allowed to
make and watch them be refused. Try to make task A block task B while B already
blocks A, and watch it be rejected.

---

### M4 — Subtasks

- A developer creates subtasks under a task assigned to them
- Subtasks shown on the parent, with progress (`3 of 5`)
- A parent cannot be `DONE` while a subtask is open
- Subtasks appear on the board only when filtered in

**Demo:** a developer splits their task into four, completes three, and cannot
close the parent.

---

### M5 — Comments and attachments

- Comments on tasks, with @mentions
- The **internal** checkbox — filtered out of every client response
- File upload to S3-compatible storage, on tasks and comments
- Comment history in the activity feed

**Demo:** a developer writes an internal comment. The PM sees it. The client,
logged in beside them, does not.

---

### M6 — Notifications

- In-app notification centre, with unread count
- Email delivery (adapter interface, so SMTP and Resend are interchangeable)
- Immediate triggers: assigned, mentioned, status changed, blocked
- **The deadline job:** 2 days before, on the day, and overdue — with the
  `reminderSentAt` / `overdueNotified` flags that make it safe to run twice
- Per-user preferences: in-app / email / off

**Demo:** set a task due in two days, run the job manually, watch the email
arrive. Run it again and watch nothing arrive.

---

### M7 — Client experience and visibility control

*The module with the highest cost of getting it wrong — a leak here is sent to a
client, by us, automatically.*

- `ProjectVisibility` table, three presets, six toggles
- Per-task `clientVisible` override, with an activity entry on every change
- **Server-side enforcement**: hidden tasks absent from the query, not filtered
  in the UI. Direct URL returns `404`, not `403`
- Field-level redaction for assignees, dates, time tracking, blocked reasons
- **Preview as client** — the PM sees exactly what the client sees
- Client home: progress, what finished this week, what is blocked, what is next
- Read-only board and task list, respecting every setting
- **The seven tests from [`04-client-visibility.md`](04-client-visibility.md) §9**
  — these are the module; the screens are what goes around them

**Demo:** two browsers. Hide a task in one, watch it vanish from the other —
including from the API response, not just the page. Then press *Preview as
client* and confirm the two views match.

---

### M8 — PM ↔ Client chat

- One thread per project, PM and client only
- Send text and attachments, 5-second polling, unread counts
- Email if a message is unread after 15 minutes

**Demo:** two browsers side by side, a message crossing between them.

---

### M9 — Daily digest

- Nightly job that composes the digest from the day's activity
- **Filters hidden tasks and internal comments before composing** — the same
  code path as M7, not a second implementation
- Skipped on days with no activity
- Sent to client and PM; per-project auto-send toggle
- `DigestLog` so we know what was sent and when

**Demo:** a day of activity, then the digest email showing exactly that.

---

### M10 — AI drafting *(the only AI)*

- **DeepSeek** (`deepseek-v4-flash`) behind a provider interface — the API is
  OpenAI-compatible, so swapping providers is a config change
- Client update: daily / weekly / monthly, from tasks that changed
- "Polish this message" for the PM
- Meeting agenda from current project state
- **PM customisation:** per-project tone, length, section toggles, greeting and
  sign-off, and a standing-instructions field
- Every output opens in a **plain editable box** with Regenerate, Shorten and a
  tone switcher — not a locked output with an accept button
- Falls back to the plain template from M9 if the API is unavailable
- Token and cost logging, with a monthly cap

Full spec: [`05-ai-updates.md`](05-ai-updates.md). Expected cost is **under $1
a month** for ten projects.

**Demo:** press *Generate weekly update*, read the paragraph, change the tone,
edit a word, send. Then set `AI_ENABLED=false` and confirm the digest still
arrives in plain form.

---

### M11 — Polish

- Time logging (estimate vs logged) on tasks
- Labels
- Watchers
- Global search
- Empty states, keyboard shortcuts, an accessibility pass
- Playwright tests on the two flows that matter: assign→complete, and the client
  journey

---

## Suggested rhythm

Working in short iterations, with M0 done first:

| Iteration | Modules | What exists at the end |
| --- | --- | --- |
| 1 | M0, M1 | Log in, create a project, add people |
| 2 | M2 | Tasks can be created and assigned. **First genuinely useful build** |
| 3 | M3, M4 | Board, workflow, subtasks. A real tracker |
| 4 | M5, M6 | Comments and the notifications you asked for |
| 5 | M7, M8 | Visibility controls, and the client can be let in safely |
| 6 | M9, M10 | Automatic updates and AI drafting |
| 7 | M11 | Polish, then use it on a real project |

Do not wait for iteration 7 to start using it. **From iteration 3, run one real
internal project in TaskForge.** Every week you use it, the remaining plan gets
more accurate, and half the things on this list will turn out to matter less
than something not on it yet.

---

## Where the plan will change, and that is fine

This is a plan, not a contract — you said agile, so:

- **Sprints and story points** are out of v1. If the team asks for them twice,
  add them.
- **Chat may need to be real-time.** Polling is the right start; the note in the
  design doc says how to upgrade it if it becomes a real conversation.
- **The AI may need to be narrower or wider.** Weekly updates are the clear win.
  If nobody uses the meeting agenda after a month, delete it.
- **The client might not want to see everything.** Some clients find a full board
  alarming. If that happens, one flag per project turning the board into a
  summary view solves it.

Revisit this document at the end of each iteration. Move things, cut things, add
things. What must not change without a deliberate decision are the permission
rules and the workflow rules — those are the parts that are hard to fix later.

---

## Settled

- **AI provider** — DeepSeek `deepseek-v4-flash`. Under $1/month → doc 05
- **Client visibility** — PM-controlled, per project → doc 04
- **Stack** — React Router v7 + Express + Prisma + PostgreSQL

## Still open, none of which block M0

1. **Email provider** — Resend (simplest) or your own SMTP. Needed by M1, for
   invitations
2. **File storage** — Cloudflare R2 (cheapest), S3, or defer uploads to M11.
   Needed by M5
3. **Where it will run** — VPS, Railway, Fly.io. Affects the Docker setup only

M0 needs none of these. It can start now.
