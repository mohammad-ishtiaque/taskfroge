# TaskForge

A project management tool for software agencies. Three roles — **Client**,
**Project Manager**, **Developer** — and Jira's fundamentals without Jira's
configuration burden.

Installable on a phone, notifies by push, and speaks five languages including
two right-to-left.

```
taskforge/
├── docs/         the design. Read 00-design-review.md first
├── api/          Express + TypeScript + Prisma + PostgreSQL
├── web/          React Router v7 (framework mode) + Tailwind
└── render.yaml   both services, one blueprint
```

---

## Running it

You need Node 20.11+, Docker for Postgres, and about five minutes.

```
# ── terminal one: the API ─────────────────────────────────────────
cd api
docker compose up -d          # Postgres on 5433, not 5432 — see below
copy .env.example .env        # macOS/Linux: cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev                   # → http://localhost:4000

# ── terminal two: the web app ─────────────────────────────────────
cd web
npm install
npm run dev                   # → http://localhost:5173
```

Commands are written one per line rather than joined with `&&`, because
Windows PowerShell 5.1 — still the default on Windows — treats `&&` as a
syntax error rather than a separator.

The seed creates one account per role, all with the password `TaskForge123!`:

| Email | Role | What they see |
| --- | --- | --- |
| `pm@taskforge.test` | Project manager | Everything: workload, every project, settings |
| `dev@taskforge.test` | Developer | Their own tasks; no project settings |
| `client@taskforge.test` | Client | Only what the project's visibility toggles allow |

Open three browser profiles and sign in as each. There is no role switcher —
`?as=` existed during development and was removed, because a way to assume
another role in shipped code would be the most serious hole in the product.

**Why port 5433.** A native PostgreSQL install commonly owns 5432 on Windows,
and both it and Docker can bind it without either erroring — you simply connect
to the wrong server and wonder where your data went.

---

## Checking your work

```
# in api/
npm test                              # 131 integration tests, real database
npm run email:test -- you@example.com # does SMTP actually work

# in web/
npm run verify                        # typecheck + locale parity + 10 tests
```

Four guards run before the tests do, and each exists because something got past
the ones before it:

| Command | Catches |
| --- | --- |
| `check:schema` | a model or column in `schema.prisma` with no migration behind it |
| `test:split` | a test file that no npm script actually runs |
| `i18n:check` | a translation key present in one language and missing in another |
| `email:test` | SMTP that is configured but does not work |

---

## How it is put together

**Everything a screen needs comes from `web/app/data/gateway.server.ts`.** One
file, one seam. Swapping the mock data for the real API touched that file and
nothing else.

**Every response shape is decided in `api/src/lib/serialize.ts`.** Endpoints
used to each pick their own `select`, so `/projects` returned `_count.members`
while the screen read `memberIds`. Both typechecked. Both crashed on the first
real click.

**Client visibility is enforced in WHERE clauses, never in the UI.** A client's
response body must not contain a hidden task at all — not hidden with CSS, not
stripped after the query. `docs/04-client-visibility.md` is the specification;
`tasks.test.ts` has the seven tests that hold it.

**A missing thing is 404, never 403.** A 403 confirms that something exists,
which is information a client on another project should not have.

**No request waits for an email.** Invitations and password resets write their
row synchronously and queue the message afterwards. Awaiting a mail provider
inside `POST /projects` made a host that silently blocks outbound SMTP look
like a broken database — the project was created in 68ms and the screen said
failure fifteen seconds later. `email.test.ts` fails the build if any handler
starts awaiting `sendEmail` again.

**The session refreshes in one place.** React Router middleware on the root
route, so it runs before every loader and action and no route can forget.
`web/app/lib/session-middleware.server.ts` explains why it cannot be a loader.

---

## Deploying

`docs/07-deployment.md`, start to finish. Render for both services, Neon for
Postgres, whichever mail provider you have.

Two things worth knowing before you start:

- **Do not use Render's free Postgres.** It expires 30 days after creation and
  is then deleted. Neon's free tier has no expiry.
- **Free instance hours are shared across your whole account**, 750 a month.
  Two services running continuously need about 1,460. See the deployment doc —
  this rules out the obvious workaround for cold starts.

---

## Where the design lives

| Document | What is in it |
| --- | --- |
| `00-design-review.md` | Start here |
| `01-feature-analysis.md` | What we took from Jira, and what we deliberately left |
| `02-system-design.md` | Roles, data model, workflow, notifications |
| `03-build-plan.md` | The modules, in order |
| `04-client-visibility.md` | The three presets, six toggles, and the rule with no exceptions |
| `05-ai-updates.md` | Requirements to epics and stories — the intended differentiator |
| `06-integration-plan.md` | Endpoint map, and how the web tier consumes it |
| `07-deployment.md` | Render, Neon, email, and what breaks |

---

## Status

Everything below is built, tested and reachable from the interface.

| | |
| --- | --- |
| **Auth** | Register, sign in, refresh with rotation, password reset bound to the browser that asked |
| **Projects** | CRUD, members, invitations by email, per-project client visibility, archive and restore |
| **Tasks** | CRUD, subtasks one level deep, status workflow with a manager approval at the end, comments |
| **Views** | Dashboard per role, task table, board, calendar, analytics, team, notifications |
| **PWA** | Installable, offline page, web push |
| **Languages** | English, Bengali, Spanish, Dutch, Arabic — with real right-to-left layout |

Still to come:

- **Client portal** — a client currently gets the manager's shell with pieces
  hidden. Safe, and not what you would show a paying customer.
- **Time tracking** — `loggedHours` is on the model, in the API and in the
  visibility toggles, and has no input anywhere.
- **AI breakdown** — `docs/05-ai-updates.md`. Turning a client's paragraph into
  epics, stories and estimates is the reason to build this rather than buy it.
