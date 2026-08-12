# 00 — Design Review

Written before any code, to answer one question: **is the design actually
complete, or does it only look complete?**

I went back through every requirement you have stated and checked it against the
three design documents. Seven things were solid. **Six were missing or wrong** —
including two that would have caused rework after the code was written.

---

## Part 1 — Your requirements, checked

| # | What you asked for | Status |
| --- | --- | --- |
| 1 | Named TaskForge | ✅ |
| 2 | Basic features, not an enterprise platform | ✅ 3 roles, 18 tables, 5 statuses |
| 3 | Feature analysis and system design before code | ✅ |
| 4 | Modular implementation | ✅ 12 modules, dependency-ordered |
| 5 | Each feature: frontend + backend + testing together | ✅ Definition of done |
| 6 | Finish one, then the next | ✅ |
| 7 | Agile — add features mid-development | ✅ |
| 8 | A basic project management website | ✅ |
| 9 | Client, Project Manager, Developer | ✅ |
| 10 | PM assigns, developer adds subtasks, Jira basics | ✅ M2 and M4 |
| 11 | Status visible to client and PM; developer notified on deadline and 2 days before | ✅ M6, with the idempotency flags |
| 12 | Analyse Jira fundamentals | ✅ Doc 01 |
| 13 | Simpler than Jira's dashboards | ✅ Fixed screens per role |
| 14 | Client sees everything · PM↔client chat · daily update | ⚠️ **Revised — see below** |
| 15 | AI only for client summaries, drafts and agendas | ✅ Narrowed further, doc 05 |
| — | Internal comments hidden from the client | ✅ Was already specced |
| — | **PM controls client visibility at project creation** | 🆕 **Doc 04** |
| — | **PM can edit the AI daily digest** | 🆕 **Doc 05** |
| — | **DeepSeek instead of Claude** | 🆕 **Doc 05** |

---

## Part 2 — What I found wrong

These are genuine defects in my own design, not polish.

### 🔴 1. Two documents contradicted each other

`01-feature-analysis.md` said we keep one task link type — **blocks** — and drop
the rest. `02-system-design.md` then listed fourteen tables, and a dependency
table was not among them.

If I had started coding from doc 02, task dependencies would simply not exist,
and adding them later means a migration plus changes to the board, the digest
and the notification rules.

**Fixed:** `TaskDependency` added to the model, with a cycle check.

### 🔴 2. No way for anyone to join a project

The design had roles, permissions and project members — and no invitation flow.
A PM could not add a client who did not already have an account.

This is the kind of gap that is invisible in a design document and obvious on
day one of use.

**Fixed:** `Invitation` table, email invite, accept-and-set-password flow. Moved
into M1, because M1 is *"add a developer and a client"* and without it that
module cannot be demonstrated.

### 🔴 3. No password reset

Login was specced. "Forgot password" was not. Users forget passwords in week one.

**Fixed:** `PasswordResetToken`, single-use, 1-hour expiry, added to M0.

### 🟠 4. No rich text anywhere

Task descriptions and comments were plain `text`. Every tracker needs at minimum
lists, bold, links and inline code — a developer pasting a stack trace into a
plain textarea is a bad first impression.

**Fixed:** Markdown stored, rendered sanitised. Not a full WYSIWYG — markdown
with a small toolbar is the right size for this product.

### 🟠 5. `Organization` was in the diagram doing nothing

It appeared in the data model tree with no stated purpose. For one agency running
its own tool it is dead weight; for a tool you might later sell, it is essential
and painful to add afterwards.

**Decision:** keep it, one row, every query already scoped by it. It costs one
column now and saves a rewrite later. Written down so it is a decision rather
than an accident.

### 🟠 6. Subtask fields were ambiguous

The model said a subtask is a Task with a `parentId`, but never said whether a
subtask gets its own assignee and due date.

**Decision:** yes to both. A developer splitting work across two days needs dates
on the pieces. Subtasks inherit the parent's project and are excluded from the
main board by default.

---

## Part 3 — The change to "client sees everything"

You originally said the client sees everything. You have now added that the PM
should decide what the client sees at project creation. **That is the better
design**, and it resolves a tension the original had.

Three reasons it matters:

1. **Not every client is the same client.** A technical client wants the board.
   A non-technical client finds a column labelled "Blocked" alarming and calls
   you about it.
2. **Some fields are commercially sensitive.** Time estimates and logged hours
   are the two most obvious. In the original design a client could see that a
   task estimated at 4 hours took 11.
3. **A per-project decision is honest.** "The client sees everything" is a
   promise that gets quietly broken by whoever first needs to hide something.
   Better to make it an explicit setting than a habit of vague task titles.

The full specification is in [`04-client-visibility.md`](04-client-visibility.md).
The short version: **three presets, six toggles, one per-task override, and one
rule that is not negotiable** — internal comments are never visible to a client,
under any setting.

---

## Part 4 — Deliberately still out

Named here so they are decisions, not oversights:

| Not building | Why |
| --- | --- |
| Bulk edit (select 20 tasks, change status) | Genuinely useful, genuinely fiddly. Add in M11 if the board gets busy enough to need it |
| A separate backlog view | The task list with a `TODO` filter is the same thing until you have sprints |
| Task templates / cloning | Wait until someone is visibly copying and pasting |
| Two-factor authentication | Right call for a tool holding client data, but not before there are users. M11 or post-launch |
| Real-time chat | Polling first; the upgrade path to Server-Sent Events is written down |
| Sprints, story points, velocity | Out of v1, as agreed |

---

## Part 5 — Where the design is now

| | |
| --- | --- |
| Roles | 3 |
| Tables | **18** (14 + dependencies, invitations, reset tokens, visibility settings) |
| Task statuses | 5 |
| Modules | **12**, dependency-ordered |
| AI features | 4, all draft-only, all human-approved before sending |
| Languages | 5, including right-to-left |
| Estimated AI cost | **under $1 per month** on DeepSeek (working shown in doc 05) |

---

## Documents

| Doc | Contents |
| --- | --- |
| [`01-feature-analysis.md`](01-feature-analysis.md) | Jira's features sorted into fundamental, worth-it and deliberately dropped |
| [`02-system-design.md`](02-system-design.md) | Architecture, roles, data model, workflow, notifications, chat |
| [`03-build-plan.md`](03-build-plan.md) | 12 modules in order, definition of done, iteration rhythm |
| [`04-client-visibility.md`](04-client-visibility.md) | 🆕 What the client sees, and how the PM controls it |
| [`05-ai-updates.md`](05-ai-updates.md) | 🆕 DeepSeek, the digest pipeline, PM customisation |
