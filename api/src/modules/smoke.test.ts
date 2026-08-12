import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app';
import { closeDatabase, prisma, resetDatabase } from '../../tests/setup';

/* ==========================================================================
   Every endpoint the frontend calls, in the order a person hits them
   --------------------------------------------------------------------------
   The other suites test rules — who may do what, what a client must not see.
   This one tests *reachability and shape*: every endpoint answers, and the
   body carries the fields the screen reading it will look for.

   It exists because four bugs shipped that no rule test could have caught:

     · `/projects` sent `_count.members`; the screen read `memberIds.length`
     · `/assignable` sent `memberships[0].role`; the UI wanted a flat `role`
     · the team page called `assignable`, which is everyone *not* on the team
     · `POST /projects` wrapped its result, so a redirect built
       `/projects/undefined/tasks`

   Every one was a mismatch between two sides that each typechecked alone.
   Nothing compared them, so nothing failed until a human clicked.

   The tests run in sequence against one shared fixture rather than resetting
   between each: the point is the journey, and a broken step should visibly
   break the ones after it.
   ========================================================================== */

const app = createApp();
const PASSWORD = 'correct-horse-battery';

let token = '';
let workspaceSlug = '';
let taskKey = '';
let devId = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

/** Fails with the server's own message rather than a bare status code. */
function ok(res: { status: number; body: unknown }, expected = 200) {
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return (res.body as { data: Record<string, unknown> }).data;
}

beforeAll(async () => {
  await resetDatabase();

  const registered = await request(app).post('/api/v1/auth/register').send({
    email: 'smoke@example.test',
    password: PASSWORD,
    name: 'Priya Nair',
    organizationName: 'Moob02 Software',
  });

  token = (registered.body.data as { accessToken: string }).accessToken;

  const argon = await import('argon2');
  const dev = await prisma.user.create({
    data: {
      email: 'smokedev@example.test',
      name: 'Rahim Chowdhury',
      passwordHash: await argon.default.hash(PASSWORD),
    },
  });
  devId = dev.id;

  const org = await prisma.organization.findFirstOrThrow({});
  await prisma.membership.create({
    data: { orgId: org.id, userId: dev.id, role: 'DEVELOPER' },
  });
});

afterAll(async () => {
  await closeDatabase();
});

describe('the journey a project manager actually takes', () => {
  it('creates a workspace and gets it back by slug', async () => {
    const created = ok(
      await request(app)
        .post('/api/v1/workspaces')
        .set(auth())
        .send({ name: 'FreshCart', clientName: 'FreshCart Ltd' }),
      201,
    );

    workspaceSlug = created.slug as string;
    expect(workspaceSlug).toBe('freshcart');

    const fetched = ok(await request(app).get(`/api/v1/workspaces/freshcart`).set(auth()));
    expect(fetched.id).toBe(created.id);
  });

  it('lists workspaces with the fields the sidebar reads', async () => {
    const list = (await request(app).get('/api/v1/workspaces').set(auth())).body.data;

    expect(Array.isArray(list)).toBe(true);
    for (const field of ['id', 'slug', 'name', 'clientName']) {
      expect(list[0], `workspace missing ${field}`).toHaveProperty(field);
    }
  });

  it('creates a project and returns something the redirect can use', async () => {
    const result = ok(
      await request(app).post('/api/v1/projects').set(auth()).send({
        workspaceId: (await request(app).get('/api/v1/workspaces/freshcart').set(auth())).body.data.id,
        key: 'WEB',
        name: 'FreshCart Storefront',
        description: 'Customer-facing web store',
        priority: 'HIGH',
      }),
      201,
    );

    // The wrapper is the whole point: reading `result.key` here gives
    // undefined, and that produced `/projects/undefined/tasks`.
    expect(result).toHaveProperty('project');
    expect(result).toHaveProperty('invitations');

    const project = result.project as Record<string, unknown>;
    expect(project.key).toBe('WEB');
    // A create must return the same shape as a read. It did not, and the
    // object the UI got back was missing everything derived.
    for (const field of ['id', 'key', 'memberIds', 'memberCount', 'progress', 'visibility']) {
      expect(project, `created project missing ${field}`).toHaveProperty(field);
    }
  });

  it('lists and reads the project with a consistent shape', async () => {
    const list = (await request(app).get('/api/v1/projects').set(auth())).body.data;
    const detail = ok(await request(app).get('/api/v1/projects/WEB').set(auth()));

    for (const field of [
      'id', 'workspaceId', 'key', 'name', 'description', 'status', 'priority',
      'startDate', 'endDate', 'leadId', 'archivedAt', 'memberIds', 'memberCount', 'progress', 'visibility',
    ]) {
      expect(list[0], `list missing ${field}`).toHaveProperty(field);
      expect(detail, `detail missing ${field}`).toHaveProperty(field);
    }

    expect(detail).toHaveProperty('members');
    expect(detail).toHaveProperty('invitations');
  });

  it('invites a client and lists them with the fields the pending row draws', async () => {
    const result = ok(
      await request(app)
        .post('/api/v1/projects/WEB/invitations')
        .set(auth())
        .send({ email: 'nadia@freshcart.test', role: 'CLIENT' }),
      201,
    );

    // The two outcomes are not interchangeable. Someone already in the
    // organisation is added outright, with no link to click — reporting
    // "invitation sent" for them leaves the PM waiting on an acceptance that
    // cannot arrive, so the screen picks its sentence from this field.
    expect(result.outcome).toBe('invited');

    const detail = ok(await request(app).get('/api/v1/projects/WEB').set(auth()));
    const pending = detail.invitations as Record<string, unknown>[];

    expect(pending).toHaveLength(1);

    // Every field the settings screen's pending row renders. `expiresAt` in
    // particular: the row shows "Expires 12 Aug", and a missing date there
    // renders "Expires Invalid Date" rather than failing loudly.
    for (const field of ['id', 'email', 'role', 'expiresAt', 'createdAt']) {
      expect(pending[0], `invitation missing ${field}`).toHaveProperty(field);
    }
    expect(pending[0]!.role).toBe('CLIENT');
    expect(Number.isNaN(new Date(pending[0]!.expiresAt as string).getTime())).toBe(false);
  });

  it('revokes an invitation and drops it from the pending list', async () => {
    const before = ok(await request(app).get('/api/v1/projects/WEB').set(auth()));
    const invitation = (before.invitations as { id: string }[])[0]!;

    const revoked = await request(app)
      .delete(`/api/v1/projects/invitations/${invitation.id}`)
      .set(auth());

    expect([200, 204], JSON.stringify(revoked.body)).toContain(revoked.status);

    const after = ok(await request(app).get('/api/v1/projects/WEB').set(auth()));
    expect(after.invitations).toHaveLength(0);
  });

  it('creates a project with invitations attached and reports on each', async () => {
    // The wizard sends these. The field has been on the schema since M1 and no
    // screen ever filled it, so this path had never run outside a unit test.
    const result = ok(
      await request(app)
        .post('/api/v1/projects')
        .set(auth())
        .send({
          workspaceId: (await request(app).get('/api/v1/workspaces/freshcart').set(auth())).body.data.id,
          key: 'MOB',
          name: 'FreshCart mobile',
          invites: [
            { email: 'client@freshcart.test', role: 'CLIENT' },
            { email: 'contractor@freshcart.test', role: 'DEVELOPER' },
          ],
        }),
      201,
    );

    const report = result.invitations as { email: string; sent: boolean; outcome: string }[];

    expect(report).toHaveLength(2);
    for (const entry of report) {
      expect(entry.sent, `${entry.email} was not sent`).toBe(true);
      expect(entry.outcome).toBe('invited');
    }

    // Both landed on the project, not somewhere else. A report that says "sent"
    // while the rows went to the wrong project would look identical from here
    // without this.
    const detail = ok(await request(app).get('/api/v1/projects/MOB').set(auth()));
    expect((detail.invitations as unknown[])).toHaveLength(2);
  });

  it('archives a project, hides it, and brings it back', async () => {
    // Endpoints that shipped in M1 and had no caller until now. The round trip
    // is the test: archiving that cannot be undone is a data-loss button with
    // a friendly label.
    const archived = await request(app).post('/api/v1/projects/MOB/archive').set(auth());
    expect([200, 204], JSON.stringify(archived.body)).toContain(archived.status);

    const hidden = (await request(app).get('/api/v1/projects').set(auth())).body.data;
    expect(hidden.map((p: { key: string }) => p.key)).not.toContain('MOB');

    // And findable again, which is the only way Restore is ever reachable.
    const shown = (await request(app).get('/api/v1/projects?includeArchived=true').set(auth()))
      .body.data;
    const mob = shown.find((p: { key: string }) => p.key === 'MOB');

    expect(mob, 'archived project missing from includeArchived list').toBeTruthy();
    expect(mob.archivedAt, 'archivedAt is what the badge and the button read').toBeTruthy();

    const restored = await request(app).post('/api/v1/projects/MOB/restore').set(auth());
    expect([200, 204]).toContain(restored.status);

    const after = (await request(app).get('/api/v1/projects').set(auth())).body.data;
    expect(after.map((p: { key: string }) => p.key)).toContain('MOB');
  });

  it('separates members from assignable people', async () => {
    const members = (await request(app).get('/api/v1/projects/WEB/members').set(auth())).body.data;
    const assignable = (await request(app).get('/api/v1/projects/WEB/assignable').set(auth())).body.data;

    for (const person of [...members, ...assignable]) {
      for (const field of ['id', 'name', 'email', 'role', 'initials', 'avatarColor']) {
        expect(person, `person missing ${field}`).toHaveProperty(field);
      }
    }

    expect(members.map((p: { email: string }) => p.email)).toEqual(['smoke@example.test']);
    expect(assignable.map((p: { email: string }) => p.email)).toEqual(['smokedev@example.test']);
  });

  it('adds a member, then finds them among members rather than assignable', async () => {
    ok(await request(app).post('/api/v1/projects/WEB/members').set(auth()).send({ userId: devId }), 201);

    const members = (await request(app).get('/api/v1/projects/WEB/members').set(auth())).body.data;
    const assignable = (await request(app).get('/api/v1/projects/WEB/assignable').set(auth())).body.data;

    expect(members).toHaveLength(2);
    expect(assignable).toHaveLength(0);
  });

  it('creates a task with the fields the table renders', async () => {
    const task = ok(
      await request(app).post(`/api/v1/projects/WEB/tasks`).set(auth()).send({
        title: 'Sign in with Google',
        type: 'STORY',
        priority: 'HIGH',
        assigneeId: devId,
        dueDate: '2026-12-01',
        estimateHours: 16,
      }),
      201,
    );

    taskKey = task.key as string;
    expect(taskKey).toBe('WEB-1');

    for (const field of [
      'id', 'key', 'title', 'type', 'status', 'priority',
      'assigneeId', 'dueDate', 'clientVisible',
    ]) {
      expect(task, `task missing ${field}`).toHaveProperty(field);
    }

    // The table draws an avatar from this. It has to be the serialised person,
    // not a bare id, or the cell renders blank.
    expect(task.assignee).toHaveProperty('initials');
    expect(task.assignee).toHaveProperty('avatarColor');
  });

  it('lists tasks and applies each filter the screen offers', async () => {
    const all = (await request(app).get('/api/v1/projects/WEB/tasks').set(auth())).body.data;
    expect(all).toHaveLength(1);

    for (const [query, expected] of [
      ['status=TODO', 1],
      ['status=DONE', 0],
      ['type=STORY', 1],
      ['type=BUG', 0],
      ['priority=HIGH', 1],
      ['priority=LOW', 0],
      [`assigneeId=${devId}`, 1],
      ['assigneeId=UNASSIGNED', 0],
      ['search=Google', 1],
      ['search=nothing-matches-this', 0],
    ] as [string, number][]) {
      const res = await request(app).get(`/api/v1/projects/WEB/tasks?${query}`).set(auth());
      expect(res.body.data, `filter ${query}`).toHaveLength(expected);
    }
  });

  it('reads one task with its project and subtasks attached', async () => {
    const task = ok(await request(app).get(`/api/v1/tasks/${taskKey}`).set(auth()));

    // The detail screen reads all three off the one response rather than
    // making three round trips.
    expect(task).toHaveProperty('project');
    expect(task).toHaveProperty('subtasks');
    expect(task).toHaveProperty('assignee');
    expect((task.project as { visibility: unknown }).visibility).toBeTruthy();
  });

  it('adds a subtask, a comment, and moves the status', async () => {
    const parent = ok(await request(app).get(`/api/v1/tasks/${taskKey}`).set(auth()));

    ok(
      await request(app).post('/api/v1/projects/WEB/tasks').set(auth()).send({
        title: 'Backend callback',
        parentId: parent.id,
      }),
      201,
    );

    const comment = ok(
      await request(app)
        .post(`/api/v1/tasks/${taskKey}/comments`)
        .set(auth())
        .send({ body: 'Starting on this', isInternal: false }),
      201,
    );
    expect(comment.author).toHaveProperty('initials');

    const comments = (await request(app).get(`/api/v1/tasks/${taskKey}/comments`).set(auth())).body.data;
    expect(comments).toHaveLength(1);

    // Deleting one — reachable from a screen only as of this change, so this
    // is the first time the endpoint has been exercised end to end. A soft
    // delete on the server, which is why the check is "gone from the list"
    // rather than "row destroyed".
    const removed = await request(app)
      .delete(`/api/v1/comments/${comment.id as string}`)
      .set(auth());
    expect([200, 204], JSON.stringify(removed.body)).toContain(removed.status);

    const afterDelete = (await request(app).get(`/api/v1/tasks/${taskKey}/comments`).set(auth()))
      .body.data;
    expect(afterDelete).toHaveLength(0);

    // Put one back, so the tests after this still have a thread to read.
    await request(app)
      .post(`/api/v1/tasks/${taskKey}/comments`)
      .set(auth())
      .send({ body: 'Starting on this', isInternal: false });

    const moved = ok(
      await request(app).patch(`/api/v1/tasks/${taskKey}/status`).set(auth()).send({
        status: 'IN_PROGRESS',
      }),
    );
    expect(moved.status).toBe('IN_PROGRESS');
  });

  it('serves the tabs: stats, activity and my tasks', async () => {
    const stats = ok(await request(app).get('/api/v1/projects/WEB/stats').set(auth()));

    for (const field of [
      'totalTasks', 'completedTasks', 'inProgressTasks', 'overdueTasks',
      'teamSize', 'completionRate', 'byStatus', 'byType', 'byPriority',
    ]) {
      expect(stats, `stats missing ${field}`).toHaveProperty(field);
    }

    // Every enum member, including the ones with no tasks.
    //
    // `groupBy` returns only rows that exist, so a project with one in-progress
    // task answered `{ IN_PROGRESS: 1 }`. The analytics screen divides each
    // count by the total and renders a percentage, so five of the six statuses
    // came out as `NaN%`, and its "active" card — IN_PROGRESS + IN_REVIEW +
    // BLOCKED — was `1 + undefined + undefined`, printed as `NaN`.
    //
    // The web type already claimed `Record<TaskStatus, number>`. It was simply
    // false, and both sides typechecked against their own idea of the truth.
    const complete: [string, string[]][] = [
      ['byStatus', ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE']],
      ['byType', ['TASK', 'BUG', 'STORY', 'CHORE']],
      ['byPriority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']],
    ];

    for (const [group, members] of complete) {
      const counts = stats[group] as Record<string, unknown>;

      for (const member of members) {
        expect(counts, `${group} is missing ${member}`).toHaveProperty(member);
        expect(typeof counts[member], `${group}.${member} is not a number`).toBe('number');
      }
    }

    const activity = (await request(app).get('/api/v1/projects/WEB/activity').set(auth())).body.data;
    expect(activity.length).toBeGreaterThan(0);
    expect(activity[0]).toHaveProperty('kind');
    expect(activity[0]).toHaveProperty('actor');

    const mine = await request(app).get('/api/v1/tasks/mine').set(auth());
    expect(mine.status).toBe(200);
  });

  it('serves the dashboard in the manager shape', async () => {
    const dashboard = ok(
      await request(app).get(`/api/v1/workspaces/${workspaceSlug}/dashboard`).set(auth()),
    );

    expect(dashboard.role).toBe('PROJECT_MANAGER');
    for (const field of ['totals', 'projects', 'activity', 'blocked', 'overdue', 'awaitingReview', 'workload']) {
      expect(dashboard, `dashboard missing ${field}`).toHaveProperty(field);
    }

    // The overview list renders these directly.
    const project = (dashboard.projects as Record<string, unknown>[])[0]!;
    for (const field of ['key', 'name', 'status', 'priority', 'progress', 'memberCount']) {
      expect(project, `dashboard project missing ${field}`).toHaveProperty(field);
    }
  });

  it('serves notifications with an unread count', async () => {
    const payload = ok(await request(app).get('/api/v1/notifications').set(auth()));

    // The topbar badge reads `unread`; the page reads `notifications`. Both
    // come from this one call.
    expect(payload).toHaveProperty('notifications');
    expect(payload).toHaveProperty('unread');
    expect(typeof payload.unread).toBe('number');

    // One at a time, which is what clicking a notification does. Only
    // "mark all" was wired to a screen, so dealing with one thing meant
    // dismissing eleven.
    const rows = payload.notifications as { id: string; readAt: string | null }[];
    const unread = rows.find((n) => n.readAt === null);

    if (unread) {
      const one = await request(app)
        .post(`/api/v1/notifications/${unread.id}/read`)
        .set(auth());
      expect(one.status, JSON.stringify(one.body)).toBe(200);

      const after = ok(await request(app).get('/api/v1/notifications').set(auth()));
      expect(after.unread).toBe((payload.unread as number) - 1);
    }

    const marked = ok(await request(app).post('/api/v1/notifications/read').set(auth()));
    expect(marked).toHaveProperty('marked');

    const cleared = ok(await request(app).get('/api/v1/notifications').set(auth()));
    expect(cleared.unread).toBe(0);
  });

  it('updates the project and its visibility', async () => {
    const updated = ok(
      await request(app).patch('/api/v1/projects/WEB').set(auth()).send({
        name: 'FreshCart Storefront v2',
        status: 'ACTIVE',
        priority: 'URGENT',
      }),
    );
    expect(updated.name).toBe('FreshCart Storefront v2');

    ok(
      await request(app).put('/api/v1/projects/WEB/visibility').set(auth()).send({
        preset: 'CUSTOM',
        showBoard: false,
        showAssignees: true,
        showDueDates: true,
        showTimeTracking: false,
        showBlockedReasons: false,
        showAttachments: true,
      }),
    );

    const after = ok(await request(app).get('/api/v1/projects/WEB').set(auth()));
    expect((after.visibility as { showBoard: boolean }).showBoard).toBe(false);
  });

  it('updates the workspace', async () => {
    const updated = ok(
      await request(app)
        .patch(`/api/v1/workspaces/${workspaceSlug}`)
        .set(auth())
        .send({ name: 'FreshCart Group' }),
    );
    expect(updated.name).toBe('FreshCart Group');
    // The slug is fixed on purpose: saved links must keep working.
    expect(updated.slug).toBe(workspaceSlug);
  });

  it('leaves no endpoint the frontend calls unreachable', async () => {
    // A 404 here means a route the gateway calls does not exist. Any other
    // status — including 400 and 403 — means it is wired and answering.
    const endpoints: [string, string][] = [
      ['get', '/api/v1/workspaces'],
      ['get', `/api/v1/workspaces/${workspaceSlug}`],
      ['get', `/api/v1/workspaces/${workspaceSlug}/dashboard`],
      ['get', '/api/v1/projects'],
      ['get', '/api/v1/projects/WEB'],
      ['get', '/api/v1/projects/WEB/stats'],
      ['get', '/api/v1/projects/WEB/members'],
      ['get', '/api/v1/projects/WEB/assignable'],
      ['get', '/api/v1/projects/WEB/tasks'],
      ['get', '/api/v1/projects/WEB/activity'],
      ['get', '/api/v1/tasks/mine'],
      ['get', `/api/v1/tasks/${taskKey}`],
      ['get', `/api/v1/tasks/${taskKey}/comments`],
      ['get', '/api/v1/notifications'],
      ['get', '/api/v1/auth/me'],
    ];

    for (const [, path] of endpoints) {
      const response = await request(app).get(path).set(auth());
      expect(response.status, `GET ${path} is not reachable`).not.toBe(404);
    }
  });
});
