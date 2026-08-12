# 02 — System Design

**Product:** TaskForge
**Scope:** everything marked *In* in [`01-feature-analysis.md`](01-feature-analysis.md)

---

## 1. Architecture

Two applications, two folders, two repositories, as you asked.

```text
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  taskforge-web               │        │  taskforge-api               │
│  React Router v7             │  HTTP  │  Express + TypeScript        │
│  (framework mode — "Remix")  │ ─────► │  Prisma                      │
│                              │  JWT   │                              │
│  loaders / actions           │        │  modules/                    │
│  Tailwind + tokens           │        │   auth projects tasks        │
│  5 locales, RTL              │        │   comments notify chat ai    │
└──────────────────────────────┘        └──────────────┬───────────────┘
                                                       │
                                        ┌──────────────┴───────────────┐
                                        │  PostgreSQL                  │
                                        │  + node-cron (deadlines,     │
                                        │    daily digest)             │
                                        │  + DeepSeek API (drafting)   │
                                        │  + SMTP / Resend (email)     │
                                        └──────────────────────────────┘
```

### Stack decisions, and why

| Choice | Reason |
| --- | --- |
| **React Router v7, framework mode** | This *is* Remix — the projects merged in v7. Loaders and actions, nested routes, progressive enhancement. Runs on any Node host or Cloudflare Workers, so hosting is a $5 VPS rather than a Vercel bill |
| **Express + TypeScript, not NestJS** | You asked for basic. NestJS brings decorators, dependency injection and modules — real structure, but concepts to learn before reading the code. Express with a disciplined folder layout gives the same module boundaries with a fraction of the vocabulary. If the API outgrows it, moving to NestJS later is mechanical |
| **Prisma + PostgreSQL** | Typed queries, readable migrations, and the schema doubles as documentation |
| **JWT access + refresh, httpOnly cookies** | The web app is the only client for now; cookies keep tokens out of reach of scripts |
| **node-cron in the API process** | Two scheduled jobs. A queue system (BullMQ, Redis) is the right answer at scale and the wrong answer at two jobs |
| **Polling for chat, not WebSockets** | A 5-second poll on one thread per project is a few requests a minute. WebSockets add a connection lifecycle to manage, for a chat nobody is using as instant messaging. Documented upgrade path if it ever matters |

> **Cost check.** Both apps are plain Node processes. One small VPS or a
> Railway/Fly.io hobby plan runs the whole thing, including Postgres. That was
> your reason for avoiding Next.js and it holds.

---

## 2. Roles

Three roles. No permission editor, no schemes — these rules are the product.

| | Client | Project Manager | Developer |
| --- | :---: | :---: | :---: |
| See project, board, all tasks | ⚙️ | ✓ | ✓ |
| See internal comments | ✗ | ✓ | ✓ |
| Create project | ✗ | ✓ | ✗ |
| Add or remove members | ✗ | ✓ | ✗ |
| Create task | ✗ | ✓ | ✗ |
| Edit any task | ✗ | ✓ | own only |
| **Assign task to someone** | ✗ | ✓ | ✗ |
| Change status | ✗ | ✓ | own tasks |
| **Create subtask** | ✗ | ✓ | on own tasks |
| Set priority / due date | ✗ | ✓ | ✗ |
| Log time | ✗ | ✓ | own tasks |
| Comment (public) | ✓ | ✓ | ✓ |
| Comment (internal) | ✗ | ✓ | ✓ |
| Upload attachment | ✓ | ✓ | ✓ |
| **Chat with client** | ✓ | ✓ | ✗ |
| Receive daily digest | ✓ | ✓ | ✗ |
| Use AI drafting | ✗ | ✓ | ✗ |

⚙️ = the PM decides per project what the client sees. Three presets and six
toggles, specified in [`04-client-visibility.md`](04-client-visibility.md).

Three rules worth stating plainly, because they are the ones people try to bend:

- **A developer never assigns work.** They can create subtasks under a task
  already assigned to them, and those subtasks are theirs. That is the whole of
  their write access to assignment.
- **A client never changes a status.** They see every status change; they cause
  none.
- **A developer cannot change someone else's task.** Read the whole board, write
  only their own row.

---

## 3. Data model

Eighteen tables. Compare with the fifty in the previous attempt — this is the
correction.

```text
Organization                                  one row today; see note below
 └─ User ──< Membership (role: CLIENT | PROJECT_MANAGER | DEVELOPER)
      │        └─< PasswordResetToken
      │
      └─ Project ──< ProjectMember
            ├─  ProjectVisibility   what the client sees          → doc 04
            ├─< Invitation          invite by email, accept, set password
            ├─< Task ──< Task (subtask, via parentId)
            │     ├─< Comment           (isInternal — never sent to a client)
            │     ├─< Attachment
            │     ├─< TimeLog
            │     ├─< Activity
            │     ├─< Watcher
            │     ├─< TaskDependency    (BLOCKS only)
            │     └─< TaskLabel >── Label
            ├─< ChatMessage        (PM ↔ Client, per project)
            └─< DigestLog          (what we sent, and when)

Notification   (per user, in-app + email)
AiDraft        (generated updates and agendas, before sending)
```

**18 tables.** Four were missing from the first draft and are covered in
[`00-design-review.md`](00-design-review.md): `TaskDependency`, `Invitation`,
`PasswordResetToken` and `ProjectVisibility`.

**On `Organization`:** one row for now. It costs one column on each table and
saves a painful migration if this is ever sold to a second agency. A deliberate
decision, not leftover scaffolding.

### Task — the one table that matters

```text
id            uuid
projectId     uuid
parentId      uuid?      -- set = this is a subtask
key           text       -- "WEB-142", unique per project
title         text
description   text
type          enum       TASK | BUG | IMPROVEMENT
status        enum       TODO | IN_PROGRESS | IN_REVIEW | DONE | BLOCKED
priority      enum       URGENT | HIGH | MEDIUM | LOW
assigneeId    uuid?
reporterId    uuid
dueDate       date?
estimateHours decimal?
loggedHours   decimal    -- cached from TimeLog
position      float      -- board ordering
clientVisible bool       -- inherits the project default          → doc 04
blockedReason text?      -- required when status = BLOCKED
startedAt     timestamp?
completedAt   timestamp?
createdAt / updatedAt / archivedAt

-- deadline reminders are idempotent because of these two:
reminderSentAt  timestamp?
overdueNotified boolean
```

**Design notes worth keeping:**

- **Subtasks are Tasks with a `parentId`.** One table, one board, one
  notification path, one permission rule. Jira does the same, and every system
  that gave subtasks their own table regretted it.
- **Subtasks get their own assignee and due date.** A developer splitting work
  across two days needs dates on the pieces, not just the parent. They inherit
  the parent's project and are hidden from the main board unless filtered in.
- **Descriptions and comments are markdown**, stored as text and rendered
  sanitised. A developer pasting a stack trace into a plain textarea is a bad
  first impression. Markdown with a small toolbar, not a full WYSIWYG.
- **`TaskDependency` keeps one link type: `BLOCKS`.** A cycle check runs on
  write. The other Jira link types are filing taxonomy nobody maintains.
- **`key` is generated per project** from a counter on `Project`, incremented in
  the same transaction as the insert. A unique index on `(projectId, key)` is
  the backstop if two creates ever race.
- **`loggedHours` is a cache**, recomputed from `TimeLog`. Never the source of
  truth.
- **`reminderSentAt` and `overdueNotified`** exist so the nightly job can run
  twice without emailing anyone twice. Scheduled jobs *will* run twice one day.
- **Soft delete** (`archivedAt`), never `DELETE`. A task referenced by a comment
  or a time log should not vanish from the history.

### Comment

```text
id, taskId, authorId, body, isInternal (bool, default false), mentions[], createdAt, editedAt
```

`isInternal` is filtered in the query, not in the UI — a client's API response
never contains an internal comment. This is the one visibility rule that is not a
setting and cannot be switched off; see [`04-client-visibility.md`](04-client-visibility.md) §1.

### ChatMessage

```text
id, projectId, authorId, body, attachmentId?, readByClientAt?, readByPmAt?, createdAt
```

One thread per project, between the PM and the client. Developers cannot see it.
Deliberately not per-task: a client with a comment box on every task will derail
engineering, and a single thread keeps the conversation where the PM can manage
it.

---

## 4. Task workflow

Five states. Not eleven.

```text
        ┌────────┐
        │  TODO  │◄──────────────┐
        └───┬────┘               │
            │ developer starts   │
      ┌─────▼────────┐           │
  ┌──►│ IN_PROGRESS  │           │ PM reopens
  │   └─────┬────────┘           │
  │         │ ready for check    │
  │   ┌─────▼────────┐           │
  │   │  IN_REVIEW   │           │
  │   └──┬────────┬──┘           │
  │      │        │ approved     │
  │ changes       │         ┌────▼───┐
  │ needed        └────────►│  DONE  │
  │      │                  └────────┘
  └──────┘
        ┌─────────┐
        │ BLOCKED │◄── from TODO, IN_PROGRESS or IN_REVIEW
        └─────────┘     (a reason is required)
```

**Rules:**

| Transition | Who | Condition |
| --- | --- | --- |
| `TODO → IN_PROGRESS` | assignee, PM | — |
| `IN_PROGRESS → IN_REVIEW` | assignee, PM | — |
| `IN_REVIEW → DONE` | **PM only** | Not the developer. Someone other than the author confirms it is finished |
| `IN_REVIEW → IN_PROGRESS` | PM | A comment explaining what is wrong is required |
| `* → BLOCKED` | assignee, PM | A reason is required |
| `BLOCKED → previous state` | assignee, PM | — |
| `DONE → TODO` | PM only | Reopen |
| A parent cannot be `DONE` | — | while any subtask is unfinished |

Every transition writes an `Activity` row and fires notifications. The client
sees all of it and can trigger none of it.

---

## 5. Notifications

### Triggers

| Event | Who is told | Channel | Timing |
| --- | --- | --- | --- |
| Task assigned to you | assignee | in-app + email | immediately |
| Status changed | reporter, watchers, PM | in-app | immediately |
| **2 days before due date** | **assignee** | **in-app + email** | daily job, 09:00 local |
| **On the due date** | **assignee**, PM | in-app + email | daily job, 09:00 local |
| Overdue | assignee, PM | in-app + email | once, the day after |
| @mentioned in a comment | mentioned user | in-app + email | immediately |
| Comment on your task | assignee, watchers | in-app | immediately |
| Task blocked | PM | in-app + email | immediately |
| New chat message | the other party | in-app + email | immediately |
| Daily digest | client, PM | email | daily job, 18:00 local |

### How the deadline job works

```text
Every day at 09:00 in the project's timezone:

  for each task where status not in (DONE, BLOCKED) and dueDate is set:

     dueDate == today + 2 days   and reminderSentAt is null
        → notify assignee "due in 2 days", set reminderSentAt

     dueDate == today            and reminderSentAt < today
        → notify assignee and PM "due today", update reminderSentAt

     dueDate <  today            and overdueNotified is false
        → notify assignee and PM "overdue", set overdueNotified = true
```

The two flags are what make it safe. A cron that fires twice, a server restarted
mid-run, a job retried after a failure — none of them produce a second email.
This is the single most common bug in notification systems and it is worth the
two columns.

### Per-user preferences

One screen, one row per event type, three choices: **in-app**, **email**, **off**.
No digest schedules, no per-project overrides. If people mute everything, that
is information about the notifications, not about the users.

---

## 6. PM ↔ Client chat

- One thread per project. Participants: every PM and every Client on that
  project. Developers have no access and no visibility.
- Plain text plus attachments. No threading, no reactions, no editing after five
  minutes.
- Unread count in the header, per project.
- **Polling every 5 seconds** while the chat screen is open; nothing when it is
  closed. If a project ever needs true real-time, the upgrade is Server-Sent
  Events on one endpoint — noted here so nobody has to rediscover it.
- Email notification if a message is unread after 15 minutes, so a client who
  never opens the app still hears about it.

---

## 7. Daily progress digest

Sent to the client and the PM at 18:00, per project, only on days when something
happened. A digest that arrives every day saying "no changes" gets filtered
within a week.

```text
FreshCart Mobile App — Tuesday 11 August

  Finished today (3)
    WEB-140  Google sign-in button
    WEB-141  Session persistence
    WEB-138  Fix cart total rounding

  Started today (2)
    WEB-142  Order history endpoint        Rahim,  due 14 Aug
    WEB-145  Order history screen          Marta,  due 16 Aug

  Blocked (1)
    WEB-139  Database migration            waiting on DBA approval

  Due in the next 3 days (2)
    WEB-142  Order history endpoint        14 Aug
    WEB-143  Empty-state design            15 Aug

  Progress: 24 of 38 tasks complete (63%)
```

The PM sees the same email plus an **"Edit before sending"** link — the AI draft
from §8 opens pre-filled, and nothing goes to the client until the PM presses
send. On projects where the PM trusts it, auto-send can be switched on per
project.

---

## 8. AI — the only AI feature

Moved to its own document: [`05-ai-updates.md`](05-ai-updates.md).

Summary: **DeepSeek `deepseek-v4-flash`** (OpenAI-compatible API, roughly
$0.12/month for ten projects), four features only — client updates, message
polishing, meeting agendas, notes-to-tasks — every output a draft that a human
sends. If DeepSeek is unavailable the digest still goes out using the plain
template from §7.

## 9. Screens

Simple, and different per role. Not Jira's configurable dashboards.

### Client

```text
Home          project status, progress bar, what finished this week,
              what is blocked, what is coming
Board         read-only, the same board the team sees
Tasks         list with filters, read-only
Chat          conversation with the PM
Files         attachments and documents
```

### Project Manager

```text
Home          across all projects: overdue, blocked, unassigned,
              awaiting my review
Project       board, backlog, team, timeline
Chat          one thread per client, with unread counts
Updates       AI drafting: daily / weekly / monthly, and agendas
Team          who has what, and how much
```

### Developer

```text
My Work       my tasks, grouped by due date. The landing screen
Board         the project board
Task detail   description, subtasks, comments, time log
```

Three screens for a developer. A developer who opens this tool wants to know
what to do next, and that should not require navigation.

---

## 10. Non-functional decisions

| Concern | Decision |
| --- | --- |
| **Languages** | English, Bangla, Spanish, Dutch, Arabic. Arabic is right-to-left, handled with CSS logical properties so `dir="rtl"` is the whole implementation |
| **Auth** | Email and password (argon2id), JWT access token, refresh in an httpOnly cookie. Password reset by single-use token, 1-hour expiry. Users join a project by email invitation |
| **Errors** | One response envelope; a stable `error.code` the UI translates. Server messages never render to users |
| **Logging** | Structured JSON with a request id on every line |
| **Files** | S3-compatible storage (Cloudflare R2 is cheapest), 10 MB limit, images and PDFs |
| **Email** | Resend or plain SMTP — one adapter interface, swap freely |
| **Timezones** | Stored UTC, displayed in the user's timezone. Scheduled jobs run in the project's timezone, because a deadline reminder at 09:00 must mean the client's 09:00 |
| **Testing** | Vitest for units, Supertest for API integration, Playwright for the two flows that matter most (assign→complete, and client approval) |
| **Deployment** | Two Node processes plus Postgres. One VPS, or Railway/Fly.io |

---

*Next: [`03-build-plan.md`](03-build-plan.md) turns this into an ordered list of
modules, each shipped complete before the next begins.*
