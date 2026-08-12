# 06 — Frontend/Backend Integration

**State:** the API is built and 79 integration tests pass. The web app still
reads an in-memory mock. This document is the exact remaining work to connect
them, written so it can be executed without re-deriving anything.

---

## Where the seam is

Every workspace screen reads `web/app/data/gateway.server.ts`. Nothing else in
the web app touches data. That was deliberate — integration is rewriting the
bodies of one file, not touching fifteen screens.

```
15 screens  →  gateway.server.ts  →  [ mock store ]     ← today
15 screens  →  gateway.server.ts  →  callApi → API      ← after
```

---

## Step 1 — Rewrite the gateway (one file)

Each function keeps its name and return shape, and swaps its body.

```ts
// before
export function listTasks(viewer: Viewer, projectId: string, filters) {
  return store.tasks.filter(/* … */);
}

// after
export async function listTasks(request: Request, projectKey: string, filters) {
  return callApi<Task[]>(`/projects/${projectKey}/tasks`, { request, query: filters });
}
```

Two signature changes ripple outward, and both are mechanical:

- **`viewer: Viewer` → `request: Request`.** `callApi` reads the bearer token
  off the request. The gateway stops needing to know who the caller is —
  the API decides, which is where that decision belongs anyway.
- **Everything becomes `async`.** Most loaders already `await`; the ones that
  do not are listed in step 2.

### Endpoint map

| Gateway function | Endpoint |
| --- | --- |
| `listWorkspaces` | `GET /workspaces` |
| `getWorkspace` | `GET /workspaces/:slug` |
| `createWorkspace` | `POST /workspaces` |
| `updateWorkspace` | `PATCH /workspaces/:slug` |
| `getDashboard` | `GET /workspaces/:slug/dashboard` |
| `listProjects` | `GET /projects?workspaceId=` |
| `getProject` | `GET /projects/:key` |
| `createProject` | `POST /projects` |
| `updateProject` | `PATCH /projects/:key` |
| `getProjectStats` | `GET /projects/:key/stats` |
| `setProjectVisibility` | `PUT /projects/:key/visibility` |
| `listTasks` | `GET /projects/:key/tasks` |
| `getTask` | `GET /tasks/:key` |
| `createTask` | `POST /projects/:key/tasks` |
| `updateTask` | `PATCH /tasks/:key` |
| `updateTaskStatus` | `PATCH /tasks/:key/status` |
| `listSubtasks` | included in `GET /tasks/:key` |
| `listMyTasks` | `GET /tasks/mine` |
| `listComments` | `GET /tasks/:key/comments` |
| `addComment` | `POST /tasks/:key/comments` |
| `listActivity` | `GET /projects/:key/activity` |
| `listNotifications` | `GET /notifications` |
| `markNotificationsRead` | `POST /notifications/read` |
| `listPeople` / `getPerson` | `GET /projects/:key/assignable` |

`toClientTask` is **deleted**. Redaction now happens server-side, which is the
only place it can be trusted — the API already returns a client's tasks
pre-redacted.

---

## Step 2 — Replace the mock viewer with the real session

`web/app/lib/shell.server.ts` currently reads a `tf-view-as` cookie.

- Delete `getViewer`, `VIEW_AS_COOKIE`, and `app/routes/view-as.tsx`.
- Delete the "View as" card in `w.$slug.settings.tsx`.
- `getShellData(request, slug)` calls `requireUser(request)` — which already
  exists and already handles token refresh.

Sign in as the seeded accounts instead:

```
pm@taskforge.test        project manager
dev@taskforge.test       developer
client@taskforge.test    client
                         password: TaskForge123!
```

### Loaders needing `await` added

These call the gateway synchronously today:

- `w.$slug._index.tsx` — `getDashboard`
- `w.$slug.projects._index.tsx` — `listProjects`
- `w.$slug.projects.$key.tsx` — `getProject`, `getProjectStats`
- `w.$slug.team.tsx`, `w.$slug.settings.tsx`, `w.$slug.search.tsx`
- `w.$slug.notifications.tsx`, `w.$slug.tasks.$taskKey.tsx`
- the four project tabs

`npx tsc --noEmit` finds every one of them once the gateway is async — a
promise where an object is expected is a type error, not a runtime surprise.

---

## Step 3 — Three dashboards

`GET /workspaces/:slug/dashboard` returns a discriminated union
(`dashboard.service.ts`). The current screen renders one shape and must split:

```tsx
switch (d.role) {
  case 'CLIENT':          return <ClientDashboard data={d} />;
  case 'PROJECT_MANAGER': return <ManagerDashboard data={d} />;
  case 'DEVELOPER':       return <DeveloperDashboard data={d} />;
}
```

| Role | Stat cards | Rails |
| --- | --- | --- |
| Client | projects · finished this week · waiting on you · upcoming | completed, waiting on you, upcoming |
| PM | projects · active · blocked · overdue · awaiting review | blocked, overdue, awaiting review, team workload |
| Developer | projects · my tasks · overdue · in progress | my tasks, overdue, in progress |

This is not cosmetic. The single shared shape gave a client three permanently
empty lists, because a client is never an assignee.

New locale keys are required for the client and PM rails — all five languages,
or non-English users see raw dotted keys.

---

## Step 4 — Verify

In this order, because each catches what the previous cannot:

1. `cd api && npm run test:integration` — 79 green
2. `cd web && npx tsc --noEmit` — every missed `await` surfaces here
3. `cd web && npm run build` — catches what typecheck does not
4. **Click every screen as all three roles.** The six bugs found so far were
   all invisible to typechecking. This step is not optional.
5. Locale parity: 377 keys × 5, no hardcoded English
6. One pass in Arabic for RTL

---

## Before production

Not integration, but not optional either.

- [ ] **Auth hardening (SEC1/SEC2)** — the reset/OTP challenge binding in
      `api/src/modules/auth/challenge.ts` is written but **not wired**. Reset
      still accepts a token alone, so a forwarded link is enough to take an
      account.
- [ ] **Email verification** — schema exists, service does not. A user
      registers and is trusted immediately.
- [ ] **Real email transport** — currently prints to console. Invitations and
      resets do not actually reach anyone.
- [ ] **Markdown sanitising** — task descriptions render as plain text. HTML
      rendering without a sanitiser is stored XSS in a product where clients
      type.
- [ ] `JWT_SECRET` / `REFRESH_SECRET` generated fresh, not the dev values
- [ ] `ALLOW_REGISTRATION=false` once the team is set up
- [ ] Database backups
- [ ] The deadline job (M6) — `reminderSentAt` / `overdueNotified` columns
      exist and nothing writes them, so no deadline notification is sent

---

## Honest sizing

| | |
| --- | --- |
| Steps 1–3 | ~700 lines across 18 files |
| Step 4 | the part that finds the bugs |
| Auth hardening | separate, and it gates production |

Steps 1–3 half-done leaves every workspace screen broken. It is worth doing in
one pass rather than in slices.
