# TaskForge

A project management tool for software agencies. Three roles — **Client**,
**Project Manager**, **Developer** — and Jira's fundamentals without Jira's
configuration burden.

```
taskforge/
├── docs/     the design. Read 00-design-review.md first
├── api/      Express + TypeScript + Prisma + PostgreSQL
└── web/      React Router v7 (framework mode) + Tailwind + 5 languages
```

---

## Status: M0 complete

We build one module at a time. Each ships its backend, frontend and tests
together, and has to be demonstrable in a browser before the next one starts.

| Module | What it adds | Status |
| --- | --- | :---: |
| **M0** | **Auth, roles, account settings, error handling, 5 languages, the shell** | ✅ **done** |
| M1 | Projects, invitations, client-visibility settings | next |
| M2 | Tasks — the core | |
| M3 | Board and status workflow | |
| M4 | Subtasks | |
| M5 | Comments and attachments | |
| M6 | Notifications, including the deadline reminders | |
| M7 | Client experience and visibility enforcement | |
| M8 | PM ↔ client chat | |
| M9 | Daily digest | |
| M10 | AI drafting (DeepSeek) | |
| M11 | Polish | |

Full plan: [`docs/03-build-plan.md`](docs/03-build-plan.md).

---

## Run it

You need **Node 20+** and **Docker Desktop running**.

> If `docker compose` says it cannot find `//./pipe/dockerDesktopLinuxEngine`,
> Docker Desktop is not running. Start it and wait for "Engine running".

### Terminal 1 — the API

```bash
cd api
docker compose up -d              # PostgreSQL on :5433
cp .env.example .env
npm install
npx prisma migrate dev --name m0_auth
npm run db:seed
npm run dev                       # http://localhost:4000
```

### Terminal 2 — the web app

```bash
cd web
cp .env.example .env
npm install
npm run dev                       # http://localhost:5173
```

### Sign in

Three accounts, one per role. Same password for all of them:

```
pm@taskforge.test        Project manager
dev@taskforge.test       Developer
client@taskforge.test    Client

Password:  TaskForge123!
```

Sign in as each in turn — each is greeted differently, because they are doing
different jobs. That is the M0 demo.

### Try the other four languages

The picker is in the top right. Or set it and reload — the choice is stored in
the session cookie, so the *server* renders the next page in that language.

**Try Arabic.** The entire layout mirrors: the header contents flip, spacing
reverses, and the font changes to IBM Plex Sans Arabic. There is no
right-to-left stylesheet — every component uses CSS logical properties
(`ms-auto`, `ps-3`, `border-e`), so `dir="rtl"` on `<html>` does all of it.

### Test the password reset without configuring email

`EMAIL_TRANSPORT=console` prints the email to the API terminal instead of
sending it, link included.

1. Go to **Forgot your password?**, enter `pm@taskforge.test`
2. Look at the API terminal — the reset link is printed in a box
3. Paste it into the browser and set a new password

---

## What M0 actually contains

**Security decisions worth knowing about:**

| Decision | Why |
| --- | --- |
| argon2id, 64 MiB / 3 passes | OWASP baseline. Deliberately slow, which is what makes a leaked hash impractical to attack |
| Password minimum is **length only**, 12 characters | Composition rules push people to `Password1!`. NIST dropped them in 2017 |
| Wrong password and unknown email give the **identical** response | Any difference turns login into a list of your registered users |
| A dummy hash is verified when the user does not exist | Otherwise response *timing* leaks the same thing |
| Refresh tokens rotate, and replaying an old one **revokes every session** | A replayed token means it was captured |
| Reset tokens are stored hashed, single-use, 1 hour | A leak of that table hands over nothing usable |
| A completed reset revokes all sessions | If the reset happened because the account was compromised, this is the part that removes the attacker |
| Membership is re-read on **every** request | Removing someone takes effect now, not in 15 minutes when their token expires |
| Access and refresh secrets must differ — enforced at boot | Otherwise an access token can be replayed as a refresh token |
| Tokens live in an httpOnly cookie, never `localStorage` | An injected script cannot read them |

**50 tests** cover these — 23 unit and 27 integration — including the ones that
are easy to get quietly wrong: identical responses for unknown emails, session
revocation on token replay, single-use reset links, and a role gate that fails
closed when its allow-list is empty.

---

## Verify it yourself

```bash
cd api
npm run typecheck        # compiles clean
npm run test:unit        # 23 tests — role gate, tokens, password hashing. No database needed
npm run test:integration # 27 tests — every auth endpoint. Needs the database running

cd ../web
npm run typecheck
npm run i18n:check       # 77 keys × 5 locales must match
npm run test:e2e         # 20 checks — real sign-in journey against a stub API
npm run build
```

`test:unit` and `test:e2e` need no database, so they are fast enough to run on
every change. `test:integration` is the one that needs Postgres up.

`i18n:check` fails the build if any language drifts from English. A missing key
renders as a fallback string in front of a user, in one of five languages, and
nobody notices until a customer does.

---

## Screens

| Route | |
| --- | --- |
| `/login` | Sign in |
| `/register` | Create a workspace — gated by `ALLOW_REGISTRATION` |
| `/forgot-password` · `/reset-password` | Password recovery |
| `/account` | Change password, sign out everywhere |
| `/` | Role-aware home |

---

## Two things deliberately deferred

**The schema grows per module.** M0 has five tables — `Organization`, `User`,
`Membership`, `Session`, `PasswordResetToken` — not the eighteen in the design
doc. Building tables before the features that use them means writing them twice.

**React Router v8 future flags are off.** The build prints warnings about
`v8_middleware` and friends. Turning them on in M0 would mean adopting untested
behaviour that then breaks M1 mysteriously. Worth doing deliberately, in M11.

---

## Two repos, when you want them

`api/` and `web/` are independent and each has its own `.gitignore`:

```bash
for repo in api web; do
  (cd "$repo" && git init -b main && git add . && git commit -m "feat: M0 foundation")
done
```

Do not keep this inside OneDrive. It syncs `.git/` and its locking fights with
Git's own, which corrupts history in ways that are painful to unpick. Put it
somewhere local — `C:\dev\taskforge`.
