# 01 — Feature Analysis

**Product:** TaskForge
**Question this document answers:** what does Jira actually do, which parts of
it are fundamental, and which of those do we need?

---

## 1. What Jira really is

Strip the marketing away and Jira is five things:

1. **An issue tracker** — a record with a title, a state, an owner and a history.
2. **A board** — that record rendered as a card in a column, draggable.
3. **A workflow engine** — rules about which column a card may move to next.
4. **A permission engine** — who can see and do what.
5. **A notification engine** — telling people something changed.

Everything else Jira sells — JQL, custom fields, automation rules, Advanced
Roadmaps, portfolio plans — is configuration surface layered on those five. That
surface is why Jira is powerful, and it is also why a five-person team needs a
consultant to set it up.

---

## 2. Jira's features, honestly sorted

### Genuinely fundamental — a task tracker without these is not usable

| Feature | Why it is non-negotiable |
| --- | --- |
| Issue with title, description, status, assignee, reporter | The atom of the entire system |
| Human-readable key (`WEB-142`) | How people refer to work in chat, commits, meetings |
| Subtasks | Real work does not decompose evenly; the developer doing it knows best how to split it |
| Status workflow | "In progress" vs "done" is the whole point |
| Board with drag-and-drop | The status change people actually perform 30 times a day |
| Comments | Where the decisions get made and recorded |
| Activity history | Answers "who changed this, and when?" — the question every dispute starts with |
| Assignment + notification | Work assigned to nobody, or to someone who wasn't told, is not assigned |
| Priority | Not everything is equally urgent, and the list has to say so |
| Due date | The thing deadlines are made of |
| Attachments | Screenshots, designs, error logs |
| Search and filter | Once past ~50 tasks, a board without filters is unusable |
| Projects | The container. Multi-project is not optional for an agency |
| Roles and permissions | A client must not be able to reassign your developers |

### Useful, and cheap to build — worth having in v1

| Feature | Why include |
| --- | --- |
| Labels / tags | One text field, huge filtering payoff |
| Time estimate vs time logged | The number that makes future estimates less fictional |
| Task types (Task, Bug, Improvement) | Different work, different urgency; one enum |
| Simple grouping above tasks | Jira calls it an Epic. Without it, 200 tasks is a flat list |
| Watchers | "Tell me when this moves" without being the assignee |
| @mentions in comments | The most-used notification trigger in any tracker |
| My Work view | Every person's most-visited screen, and it is one filtered query |

### Jira's complexity we are deliberately not building

| Jira feature | Why we are dropping it |
| --- | --- |
| Custom fields and field schemes | The single biggest source of Jira's setup cost. Our fields are fixed, and that is a feature |
| Custom workflow designer | Infinite configurability is exactly what makes Jira slow to use and slow to run. One good workflow, a few toggles |
| JQL | A query language is what you build when the default views are wrong. We will make the default views right |
| Permission schemes / issue security levels | Three roles with fixed rules covers our case. A permission *scheme editor* does not |
| Automation rules engine | A no-code rule builder is a product in itself. Two hard-coded rules (deadline reminders, daily digest) cover the actual need |
| Sprints, story points, velocity, burndown | Deliberately out of v1. A PM assigning tasks with due dates does not need sprint ceremonies. Add later if asked for |
| Versions, components, releases | Deployment tracking is a separate concern from task tracking |
| Advanced Roadmaps / portfolio plans | An enterprise product bolted on top |
| Multiple board configurations, swimlanes | One board layout, chosen well |
| Issue link types (blocks, relates, duplicates, clones…) | We keep one: **blocks**. The rest are filing taxonomy nobody maintains |
| Dashboards with configurable gadgets | Configurable dashboards mean nobody configures them. Fixed, role-appropriate screens instead |
| Service desk / SLAs | A different product |

> **The principle behind this table:** every configuration option Jira offers is
> a decision it refuses to make, pushed onto the customer. Making those
> decisions is our job, and it is where the product value is.

---

## 3. What you asked for that Jira does badly or not at all

These are the reasons to build this rather than buy a Jira licence.

| Your requirement | Jira's answer today | What we do |
| --- | --- | --- |
| The client sees everything | A paid seat, and a UI full of sprints and story points that confuses them | Client is a first-class role with its own simple screens |
| PM chats with the client in the tool | No. You use email, Slack or a separate portal | Built-in PM↔client thread, per project |
| Automatic daily progress update to the client | No. A PM writes it manually every evening, or it does not happen | Generated and sent automatically |
| Developer warned 2 days before a deadline | Only via a paid automation rule someone has to build | Built in, on by default |
| AI drafts the client update | Jira's AI summarises tickets; it does not write the client-facing message | Core feature, and the only AI we build |

---

## 4. TaskForge v1 — the scope line

**In:**

- Three roles: Client, Project Manager, Developer
- Projects, with members
- Tasks: key, title, description, type, status, priority, assignee, reporter,
  due date, estimate, logged time, labels
- Subtasks, created by the assigned developer
- Board (drag to change status), list view with filters, My Work
- Comments with @mentions, and attachments
- Activity history on every task
- Notifications: in-app and email
  - assigned to you
  - status changed on a task you own or watch
  - **2 days before your due date**
  - **on the due date**
  - overdue
  - @mentioned
- Client visibility across the whole project
- PM ↔ Client chat, per project
- Automatic daily progress digest to the client
- AI: draft the client update (daily / weekly / monthly) and meeting agendas
- Five languages: English, Bangla, Spanish, Dutch, Arabic (right-to-left)

**Out of v1, revisit when someone actually asks:**

- Sprints, story points, velocity, burndown
- Custom fields, custom workflows
- Invoicing, budgets, margin
- Releases, environments, deployment tracking
- QA test-case management
- Git integration
- Mobile app

**Explicitly never:**

- A query language
- A permission scheme editor
- A no-code automation builder

---

## 5. The one thing worth arguing about

**Should the client really see everything?**

You said yes, and for an agency that wants to compete on transparency that is a
strong position. Two consequences to accept knowingly:

1. **Internal comments.** Developers need somewhere to say "this estimate was
   always optimistic" without it reaching the client. Recommendation: keep every
   task and status visible to the client, but let comments be marked *internal*.
   One checkbox, default off.
2. **Task titles are now client-facing.** "Fix the mess Rahim made in the auth
   module" becomes a client-visible sentence. This is a culture change more than
   a technical one, and it is worth telling the team before launch.

Everything else — statuses, due dates, assignees, progress — the client sees.

---

*Next: [`02-system-design.md`](02-system-design.md) turns this scope into a data
model, a workflow and an architecture.*
