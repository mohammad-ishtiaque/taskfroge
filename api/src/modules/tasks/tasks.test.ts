import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../app';
import {
  assertTruncateCoversEveryTable,
  closeDatabase,
  prisma,
  resetDatabase,
} from '../../../tests/setup';

/* ==========================================================================
   Tasks, and the client-visibility rules
   --------------------------------------------------------------------------
   The seven tests in `docs/04-client-visibility.md` §9 are not tests *of* the
   visibility module — they *are* the module. The screens are what goes around
   them. They are marked below so a future reader can find them.

   Every assertion about what a client cannot see checks the **response body**,
   not the rendered page. A client with the network tab open is not a threat
   model, it is a Tuesday.
   ========================================================================== */

const app = createApp();
const PASSWORD = 'correct-horse-battery';

async function signUpAgency(email = 'pm@example.test') {
  const response = await request(app).post('/api/v1/auth/register').send({
    email,
    password: PASSWORD,
    name: 'Priya Nair',
    organizationName: 'Moob02 Software',
  });
  return response.body.data as { accessToken: string; user: { id: string }; organization: { id: string } };
}

async function addTeamMember(orgId: string, email: string, role: 'DEVELOPER' | 'CLIENT' | 'PROJECT_MANAGER') {
  const argon = await import('argon2');
  const user = await prisma.user.create({
    data: { email, name: email.split('@')[0]!, passwordHash: await argon.default.hash(PASSWORD) },
  });
  await prisma.membership.create({ data: { orgId, userId: user.id, role } });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  return { userId: user.id, accessToken: login.body.data.accessToken as string };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A workspace, a project, a developer and a client, all wired together. */
async function scenario() {
  const pm = await signUpAgency();
  const dev = await addTeamMember(pm.organization.id, 'dev@example.test', 'DEVELOPER');
  const client = await addTeamMember(pm.organization.id, 'client@example.test', 'CLIENT');

  const ws = await request(app)
    .post('/api/v1/workspaces')
    .set(auth(pm.accessToken))
    .send({ name: 'FreshCart', clientName: 'FreshCart Ltd' });

  const project = await request(app)
    .post('/api/v1/projects')
    .set(auth(pm.accessToken))
    .send({ key: 'WEB', name: 'FreshCart Web', workspaceId: ws.body.data.id });

  if (!ws.body?.data?.id) throw new Error(`workspace: ${JSON.stringify(ws.body)}`);
  const projectId = project.body?.data?.project?.id ?? project.body?.data?.id;
  // Without this the failure surfaces fifteen assertions later as "cannot read
  // property of undefined", and the real message is right here.
  if (!projectId) throw new Error(`project: ${JSON.stringify(project.body)}`);

  for (const userId of [dev.userId, client.userId]) {
    await prisma.projectMember.create({ data: { projectId, userId } });
  }

  return { pm, dev, client, workspace: ws.body.data, projectId };
}

async function createTask(token: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/projects/WEB/tasks')
    .set(auth(token))
    .send({ title: 'Sign in with Google', ...body });
}

/** Creates a task and fails with the server's message if it did not work. */
async function createTaskOrThrow(token: string, body: Record<string, unknown> = {}) {
  const response = await createTask(token, body);
  if (response.status !== 201) {
    throw new Error(`createTask ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('test harness', () => {
  it('truncates every table the schema defines', async () => {
    // Guards the guard: adding a model without adding it to TRUNCATED_TABLES
    // fails here rather than as an unrelated flaky test months later.
    await assertTruncateCoversEveryTable();
  });
});

/* ── Key allocation ─────────────────────────────────────────────────────── */

describe('task keys', () => {
  it('numbers tasks sequentially from the project key', async () => {
    const { pm } = await scenario();

    const first = await createTaskOrThrow(pm.accessToken);
    const second = await createTaskOrThrow(pm.accessToken, { title: 'Order history' });

    expect(first.body.data.key).toBe('WEB-1');
    expect(second.body.data.key).toBe('WEB-2');
  });

  /**
   * The failure this prevents: two people press Create at the same moment,
   * both read max(number) = 5, both try to write 6, and one gets a unique
   * constraint error they did nothing to cause.
   */
  it('never issues the same key twice under concurrent creates', async () => {
    const { pm } = await scenario();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createTask(pm.accessToken, { title: `Task ${i}` })),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);

    const keys = results.map((r) => r.body.data.key as string);
    expect(new Set(keys).size).toBe(8);
    expect([...keys].sort()).toEqual(
      ['WEB-1', 'WEB-2', 'WEB-3', 'WEB-4', 'WEB-5', 'WEB-6', 'WEB-7', 'WEB-8'].sort(),
    );
  });
});

/* ── Status workflow ────────────────────────────────────────────────────── */

describe('status transitions', () => {
  it('refuses BLOCKED without a reason', async () => {
    const { pm } = await scenario();
    await createTask(pm.accessToken);

    const response = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(pm.accessToken))
      .send({ status: 'BLOCKED' });

    // 400 is this codebase's status for a failed validation, from
    // AppError.validation. Consistency with the other 30 endpoints matters
    // more than my preference for 422.
    expect(response.status).toBe(400);
    expect(response.body.error.details.issues.blockedReason).toBeTruthy();
  });

  it('clears the blocked reason when the task moves on', async () => {
    const { pm } = await scenario();
    await createTask(pm.accessToken);

    await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(pm.accessToken))
      .send({ status: 'BLOCKED', blockedReason: 'Waiting on the DBA' });

    const moved = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(pm.accessToken))
      .send({ status: 'IN_PROGRESS' });

    // A stale reason on an unblocked task is worse than none: it reads as
    // current on the board.
    expect(moved.body.data.blockedReason).toBeNull();
  });

  it('lets a developer move their own task but not someone else’s', async () => {
    const { pm, dev } = await scenario();
    await createTask(pm.accessToken, { assigneeId: dev.userId });
    await createTask(pm.accessToken, { title: 'Not theirs' });

    const own = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(dev.accessToken))
      .send({ status: 'IN_PROGRESS' });

    const other = await request(app)
      .patch('/api/v1/tasks/WEB-2/status')
      .set(auth(dev.accessToken))
      .send({ status: 'IN_PROGRESS' });

    expect(own.status).toBe(200);
    expect(other.status).toBe(403);
  });

  /**
   * Self-approval is how "done" stops meaning anything. A developer marks work
   * IN_REVIEW; someone else agrees it is finished.
   */
  it('lets only a project manager mark a task done', async () => {
    const { pm, dev } = await scenario();
    await createTask(pm.accessToken, { assigneeId: dev.userId });

    const byDev = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(dev.accessToken))
      .send({ status: 'DONE' });

    expect(byDev.status).toBe(403);
    expect(byDev.body.error.details.code).toBe('PM_APPROVAL_REQUIRED');

    const byPm = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(pm.accessToken))
      .send({ status: 'DONE' });

    expect(byPm.status).toBe(200);
  });

  it('refuses to close a parent while a subtask is open', async () => {
    const { pm } = await scenario();
    const parent = await createTaskOrThrow(pm.accessToken);

    await createTask(pm.accessToken, { title: 'Backend', parentId: parent.body.data.id });

    const response = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(pm.accessToken))
      .send({ status: 'DONE' });

    expect(response.status).toBe(409);
    expect(response.body.error.details.code).toBe('SUBTASKS_OPEN');

    // Close the subtask, and the parent can then close.
    await request(app)
      .patch('/api/v1/tasks/WEB-2/status')
      .set(auth(pm.accessToken))
      .send({ status: 'DONE' });

    const retry = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(pm.accessToken))
      .send({ status: 'DONE' });

    expect(retry.status).toBe(200);
  });

  it('refuses a subtask of a subtask', async () => {
    const { pm } = await scenario();
    const parent = await createTaskOrThrow(pm.accessToken);
    const child = await createTaskOrThrow(pm.accessToken, { title: 'Child', parentId: parent.body.data.id });

    const grandchild = await createTask(pm.accessToken, {
      title: 'Grandchild',
      parentId: child.body.data.id,
    });

    expect(grandchild.status).toBe(400);
  });
});

/* ── Assignment ─────────────────────────────────────────────────────────── */

describe('assignment', () => {
  it('refuses to assign work to someone who is not on the project', async () => {
    const { pm } = await scenario();

    const stranger = await prisma.user.create({
      data: { email: 'stranger@example.test', name: 'Stranger', passwordHash: 'x' },
    });

    const response = await createTask(pm.accessToken, { assigneeId: stranger.id });

    // Otherwise the assignee is accountable for a task their own list cannot
    // show them — task queries scope by project membership.
    expect(response.status).toBe(400);
    expect(response.body.error.details.issues.assigneeId).toBeTruthy();
  });

  it('refuses to let a client assign anyone', async () => {
    const { client, dev } = await scenario();

    const response = await createTask(client.accessToken, {
      title: 'Please fix',
      assigneeId: dev.userId,
    });

    expect(response.status).toBe(403);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The seven tests from docs/04 §9.
   ══════════════════════════════════════════════════════════════════════════ */

describe('client visibility — docs/04 §9', () => {
  /** §9.1 */
  it('returns 404, not 403, when a client requests a hidden task directly', async () => {
    const { pm, client } = await scenario();
    await createTask(pm.accessToken, { title: 'Clean up the auth module' });

    await request(app)
      .patch('/api/v1/tasks/WEB-1')
      .set(auth(pm.accessToken))
      .send({ clientVisible: false });

    const response = await request(app).get('/api/v1/tasks/WEB-1').set(auth(client.accessToken));

    // 403 would confirm the task exists, which is itself the leak.
    expect(response.status).toBe(404);
  });

  /** §9.2 */
  it('never includes a hidden task in a client’s task list', async () => {
    const { pm, client } = await scenario();
    await createTask(pm.accessToken, { title: 'Visible work' });
    await createTask(pm.accessToken, { title: 'Internal refactor' });

    await request(app)
      .patch('/api/v1/tasks/WEB-2')
      .set(auth(pm.accessToken))
      .send({ clientVisible: false });

    const response = await request(app)
      .get('/api/v1/projects/WEB/tasks')
      .set(auth(client.accessToken));

    const body = JSON.stringify(response.body);
    expect(response.body.data).toHaveLength(1);
    expect(body).not.toContain('Internal refactor');
    expect(body).not.toContain('WEB-2');
  });

  /** §9.3 — the one that matters most. */
  it('never includes an internal comment in a client’s response body', async () => {
    const { pm, client } = await scenario();
    await createTask(pm.accessToken);

    await request(app)
      .post('/api/v1/tasks/WEB-1/comments')
      .set(auth(pm.accessToken))
      .send({ body: 'That estimate was optimistic and we all know it', isInternal: true });

    await request(app)
      .post('/api/v1/tasks/WEB-1/comments')
      .set(auth(pm.accessToken))
      .send({ body: 'On track for Friday', isInternal: false });

    const response = await request(app)
      .get('/api/v1/tasks/WEB-1/comments')
      .set(auth(client.accessToken));

    expect(response.body.data).toHaveLength(1);
    // Absent from the JSON, not hidden in the UI.
    expect(JSON.stringify(response.body)).not.toContain('optimistic');
  });

  /** §9.4 */
  it('omits estimates and logged hours when showTimeTracking is off', async () => {
    const { pm, client, projectId } = await scenario();
    await createTask(pm.accessToken, { estimateHours: 4 });

    await prisma.projectVisibility.upsert({
      where: { projectId },
      create: { projectId, showTimeTracking: false },
      update: { showTimeTracking: false },
    });

    const dashboard = await request(app)
      .get('/api/v1/workspaces/freshcart/dashboard')
      .set(auth(client.accessToken));

    const body = JSON.stringify(dashboard.body);
    expect(body).not.toContain('estimateHours');
    expect(body).not.toContain('loggedHours');
  });

  /** §9.5 */
  it('does not overwrite custom toggles when a preset is re-applied', async () => {
    const { pm, projectId } = await scenario();

    await request(app)
      .put('/api/v1/projects/WEB/visibility')
      .set(auth(pm.accessToken))
      .send({ preset: 'CUSTOM', showBoard: false, showAssignees: true, showDueDates: true,
              showTimeTracking: true, showBlockedReasons: false, showAttachments: true });

    const stored = await prisma.projectVisibility.findUnique({ where: { projectId } });

    expect(stored?.showBoard).toBe(false);
    expect(stored?.showTimeTracking).toBe(true);
    expect(stored?.showBlockedReasons).toBe(false);
  });

  /** §9.6 — the digest is built from activity, so this is the same filter. */
  it('excludes hidden tasks from a client’s activity feed', async () => {
    const { pm, client } = await scenario();
    await createTask(pm.accessToken, { title: 'Secret spike' });

    await request(app)
      .patch('/api/v1/tasks/WEB-1')
      .set(auth(pm.accessToken))
      .send({ clientVisible: false });

    await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(pm.accessToken))
      .send({ status: 'IN_PROGRESS' });

    const response = await request(app)
      .get('/api/v1/projects/WEB/activity')
      .set(auth(client.accessToken));

    expect(JSON.stringify(response.body)).not.toContain('Secret spike');
    expect(response.body.data.every((a: { clientVisible: boolean }) => a.clientVisible)).toBe(true);
  });

  /** §9.7 */
  it('never tells a client that a task was hidden from them', async () => {
    const { pm, client } = await scenario();
    await createTask(pm.accessToken);

    await request(app)
      .patch('/api/v1/tasks/WEB-1')
      .set(auth(pm.accessToken))
      .send({ clientVisible: false });

    const response = await request(app)
      .get('/api/v1/projects/WEB/activity')
      .set(auth(client.accessToken));

    // "Priya hid a task from you" is a strange thing to tell a client.
    expect(JSON.stringify(response.body)).not.toContain('VISIBILITY_CHANGED');
  });
});

/* ── Client authorship ──────────────────────────────────────────────────── */

describe('what a client may write', () => {
  it('downgrades an internal comment posted by a client rather than erroring', async () => {
    const { pm, client } = await scenario();
    await createTask(pm.accessToken);

    const response = await request(app)
      .post('/api/v1/tasks/WEB-1/comments')
      .set(auth(client.accessToken))
      .send({ body: 'Any update?', isInternal: true });

    // Refusing would tell them the concept exists.
    expect(response.status).toBe(201);
    expect(response.body.data.isInternal).toBe(false);
  });

  it('refuses to let a client change a task status', async () => {
    const { pm, client } = await scenario();
    await createTask(pm.accessToken);

    const response = await request(app)
      .patch('/api/v1/tasks/WEB-1/status')
      .set(auth(client.accessToken))
      .send({ status: 'DONE' });

    expect(response.status).toBe(403);
  });
});

/* ── Workspace isolation ────────────────────────────────────────────────── */

describe('workspace isolation', () => {
  it('shows a client only workspaces they have a project in', async () => {
    const { pm, client } = await scenario();

    await request(app)
      .post('/api/v1/workspaces')
      .set(auth(pm.accessToken))
      .send({ name: 'Northwind', clientName: 'Northwind Dental' });

    const mine = await request(app).get('/api/v1/workspaces').set(auth(client.accessToken));
    const theirs = await request(app).get('/api/v1/workspaces').set(auth(pm.accessToken));

    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].slug).toBe('freshcart');
    expect(theirs.body.data).toHaveLength(2);
  });

  it('returns 404 when a client asks for a workspace they are not in', async () => {
    const { pm, client } = await scenario();

    await request(app)
      .post('/api/v1/workspaces')
      .set(auth(pm.accessToken))
      .send({ name: 'Northwind', clientName: 'Northwind Dental' });

    const response = await request(app)
      .get('/api/v1/workspaces/northwind')
      .set(auth(client.accessToken));

    expect(response.status).toBe(404);
  });

  it('suffixes the slug rather than refusing a duplicate workspace name', async () => {
    const { pm } = await scenario();

    const second = await request(app)
      .post('/api/v1/workspaces')
      .set(auth(pm.accessToken))
      .send({ name: 'FreshCart', clientName: 'A different FreshCart' });

    // Two clients genuinely can share a name, and refusing the second would be
    // a strange thing to explain.
    expect(second.status).toBe(201);
    expect(second.body.data.slug).toBe('freshcart-2');
  });
});

/* ── Dashboards ─────────────────────────────────────────────────────────── */

describe('dashboards are shaped per role', () => {
  it('gives each role the numbers that are true for it', async () => {
    const { pm, dev, client } = await scenario();
    await createTask(pm.accessToken, { assigneeId: dev.userId });

    const get = (token: string) =>
      request(app).get('/api/v1/workspaces/freshcart/dashboard').set(auth(token));

    const [pmView, devView, clientView] = await Promise.all([
      get(pm.accessToken),
      get(dev.accessToken),
      get(client.accessToken),
    ]);

    expect(pmView.body.data.role).toBe('PROJECT_MANAGER');
    expect(pmView.body.data).toHaveProperty('workload');
    expect(pmView.body.data).toHaveProperty('awaitingReview');

    expect(devView.body.data.role).toBe('DEVELOPER');
    expect(devView.body.data.totals.myTasks).toBe(1);

    // The old shared shape gave a client "My Tasks: 0" forever, because a
    // client is never an assignee.
    expect(clientView.body.data.role).toBe('CLIENT');
    expect(clientView.body.data).not.toHaveProperty('myTasks');
    expect(clientView.body.data).toHaveProperty('waitingOnYou');
  });
});
