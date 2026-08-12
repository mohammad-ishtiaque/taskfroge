import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { closeDatabase, prisma, resetDatabase } from '../../../tests/setup';
import { hashToken, randomToken } from '../../lib/tokens';

const app = createApp();
const PASSWORD = 'correct-horse-battery';

/** Registers an agency and returns its first project manager's token. */
async function signUpAgency(email = 'pm@example.test') {
  const response = await request(app).post('/api/v1/auth/register').send({
    email,
    password: PASSWORD,
    name: 'Priya Nair',
    organizationName: 'Moob02 Software',
  });

  return response.body.data as {
    accessToken: string;
    user: { id: string };
    organization: { id: string };
  };
}

/** Adds someone to the org with a given role and signs them in. */
async function addTeamMember(orgId: string, email: string, role: 'DEVELOPER' | 'CLIENT') {
  const argon = await import('argon2');
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split('@')[0]!,
      passwordHash: await argon.default.hash(PASSWORD),
    },
  });

  await prisma.membership.create({ data: { orgId, userId: user.id, role } });

  const login = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  return { userId: user.id, accessToken: login.body.data.accessToken as string };
}

/**
 * A project needs a workspace to live in. Created on demand and reused, so a
 * test that makes two projects gets them in the same workspace unless it asks
 * otherwise — which is what "an agency with one client" looks like.
 */
async function ensureWorkspace(token: string, name = 'FreshCart') {
  const existing = await request(app)
    .get('/api/v1/workspaces')
    .set('Authorization', `Bearer ${token}`);

  const found = (existing.body.data as { id: string; name: string }[] | undefined)?.find(
    (w) => w.name === name,
  );
  if (found) return found.id;

  const created = await request(app)
    .post('/api/v1/workspaces')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, clientName: `${name} Ltd` });

  // A caller who may not create workspaces is almost certainly in a test
  // asserting they may not create *projects* either — and the role gate
  // refuses that before the workspace id is ever read. Hand back a
  // well-formed id so the test reaches the assertion it is named for.
  if (!created.body?.data?.id) {
    return '00000000-0000-4000-8000-000000000000';
  }
  return created.body.data.id as string;
}

async function createProject(token: string, key = 'WEB', name = 'FreshCart Web') {
  const workspaceId = await ensureWorkspace(token);

  return request(app)
    .post('/api/v1/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ key, name, workspaceId });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('permissions — who may create a project', () => {
  it('lets a project manager create one', async () => {
    const pm = await signUpAgency();
    const response = await createProject(pm.accessToken);

    expect(response.status).toBe(201);
    expect(response.body.data.project.key).toBe('WEB');
  });

  it('refuses a developer', async () => {
    // The rule the whole role gate exists for. If this ever passes, anyone in
    // the organisation can spin up projects.
    const pm = await signUpAgency();
    const dev = await addTeamMember(pm.organization.id, 'dev@example.test', 'DEVELOPER');

    const response = await createProject(dev.accessToken, 'DEV');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses a client', async () => {
    const pm = await signUpAgency();
    const client = await addTeamMember(pm.organization.id, 'client@example.test', 'CLIENT');

    expect((await createProject(client.accessToken, 'CLI')).status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(app).post('/api/v1/projects').send({ key: 'WEB', name: 'x' });
    expect(response.status).toBe(401);
  });
});

describe('project keys', () => {
  it('rejects a duplicate key with a field-level message', async () => {
    const pm = await signUpAgency();
    await createProject(pm.accessToken, 'WEB');

    const second = await createProject(pm.accessToken, 'WEB', 'Another project');

    expect(second.status).toBe(409);
    expect(second.body.error.details.fields).toContain('key');
  });

  it('upcases a lowercase key rather than rejecting it', async () => {
    const pm = await signUpAgency();
    const response = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ key: 'app', name: 'Mobile app', workspaceId: await ensureWorkspace(pm.accessToken) });

    expect(response.body.data.project.key).toBe('APP');
  });

  it('rejects keys with digits or punctuation', async () => {
    const pm = await signUpAgency();

    for (const key of ['WEB1', 'W-B', 'W B', 'W']) {
      const response = await createProject(pm.accessToken, key);
      expect(response.status).toBe(400);
    }
  });
});

describe('visibility defaults', () => {
  it('creates an OPEN project with time tracking still hidden', async () => {
    // The one default that contradicts its own preset, and deliberately so:
    // a client reading "estimated 4h, logged 11h" starts an awkward conversation.
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);

    const visibility = await prisma.projectVisibility.findUnique({
      where: { projectId: created.body.data.project.id },
    });

    expect(visibility!.preset).toBe('OPEN');
    expect(visibility!.showBoard).toBe(true);
    expect(visibility!.showTimeTracking).toBe(false);
  });

  it('applies the SUMMARY preset when asked', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);
    const id = created.body.data.project.id as string;

    await request(app)
      .put(`/api/v1/projects/${id}/visibility`)
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ preset: 'SUMMARY' });

    const visibility = await prisma.projectVisibility.findUnique({ where: { projectId: id } });
    expect(visibility!.showBoard).toBe(false);
    expect(visibility!.showAssignees).toBe(false);
  });

  it('refuses a developer changing what the client sees', async () => {
    const pm = await signUpAgency();
    const dev = await addTeamMember(pm.organization.id, 'dev@example.test', 'DEVELOPER');
    const created = await createProject(pm.accessToken);

    const response = await request(app)
      .put(`/api/v1/projects/${created.body.data.project.id}/visibility`)
      .set('Authorization', `Bearer ${dev.accessToken}`)
      .send({ preset: 'OPEN' });

    expect(response.status).toBe(403);
  });
});

describe('what each role can see', () => {
  it('shows a project manager every project in the organisation', async () => {
    const pm = await signUpAgency();
    await createProject(pm.accessToken, 'WEB');
    await createProject(pm.accessToken, 'APP', 'Mobile');

    const response = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${pm.accessToken}`);

    expect(response.body.data).toHaveLength(2);
  });

  it('shows a developer only projects they are on', async () => {
    const pm = await signUpAgency();
    const dev = await addTeamMember(pm.organization.id, 'dev@example.test', 'DEVELOPER');

    const joined = await createProject(pm.accessToken, 'WEB');
    await createProject(pm.accessToken, 'APP', 'Mobile');

    await request(app)
      .post(`/api/v1/projects/${joined.body.data.project.id}/members`)
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ userId: dev.userId });

    const response = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${dev.accessToken}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].key).toBe('WEB');
  });

  it('returns 404, not 403, for a project you are not on', async () => {
    // A 403 would confirm the project exists. A client on one project should
    // not be able to enumerate the others by their response codes.
    const pm = await signUpAgency();
    const dev = await addTeamMember(pm.organization.id, 'dev@example.test', 'DEVELOPER');
    const hidden = await createProject(pm.accessToken, 'WEB');

    const response = await request(app)
      .get(`/api/v1/projects/${hidden.body.data.project.id}`)
      .set('Authorization', `Bearer ${dev.accessToken}`);

    expect(response.status).toBe(404);
  });

  it('never lets one agency reach another agency’s project', async () => {
    const first = await signUpAgency('pm1@example.test');
    const other = await signUpAgency('pm2@example.test');
    const project = await createProject(first.accessToken, 'WEB');

    // Both callers are project managers, so the role gate lets them through.
    // Only the organisation check in the service stops this.
    const response = await request(app)
      .patch(`/api/v1/projects/${project.body.data.project.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ name: 'Hijacked' });

    expect(response.status).toBe(404);
  });
});

describe('members', () => {
  it('adds the creator as a member automatically', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);

    const detail = await request(app)
      .get(`/api/v1/projects/${created.body.data.project.id}`)
      .set('Authorization', `Bearer ${pm.accessToken}`);

    expect(detail.body.data.members).toHaveLength(1);
    // Flat, from the shared serialiser — not the nested `{ user: {...} }` a
    // raw Prisma include produces. Every endpoint returning a person now
    // returns this shape.
    expect(detail.body.data.members[0].id).toBe(pm.user.id);
  });

  it('refuses to remove the last project manager', async () => {
    // Otherwise the project becomes unmanageable — including nobody able to
    // add a manager back.
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);

    const response = await request(app)
      .delete(`/api/v1/projects/${created.body.data.project.id}/members/${pm.user.id}`)
      .set('Authorization', `Bearer ${pm.accessToken}`);

    expect(response.status).toBe(422);
  });

  it('refuses to add someone from outside the organisation', async () => {
    const pm = await signUpAgency('pm1@example.test');
    const stranger = await signUpAgency('pm2@example.test');
    const created = await createProject(pm.accessToken);

    const response = await request(app)
      .post(`/api/v1/projects/${created.body.data.project.id}/members`)
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ userId: stranger.user.id });

    expect(response.status).toBe(404);
  });
});

describe('invitations', () => {
  async function inviteTo(token: string, projectId: string, email: string, role = 'DEVELOPER') {
    return request(app)
      .post(`/api/v1/projects/${projectId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email, role });
  }

  it('refuses a client sending invitations', async () => {
    const pm = await signUpAgency();
    const client = await addTeamMember(pm.organization.id, 'client@example.test', 'CLIENT');
    const created = await createProject(pm.accessToken);

    const response = await inviteTo(
      client.accessToken,
      created.body.data.project.id,
      'someone@example.test',
    );

    expect(response.status).toBe(403);
  });

  it('stores the token hashed, never in plain text', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);
    await inviteTo(pm.accessToken, created.body.data.project.id, 'new@example.test');

    const invitation = await prisma.invitation.findFirst();
    expect(invitation!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates an account and joins the project when accepted', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);
    const projectId = created.body.data.project.id as string;

    // Insert with a known token — the emailed one is unrecoverable by design.
    const token = randomToken();
    await prisma.invitation.create({
      data: {
        orgId: pm.organization.id,
        projectId,
        email: 'newdev@example.test',
        role: 'DEVELOPER',
        tokenHash: hashToken(token),
        invitedById: pm.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const accept = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token, name: 'New Dev', password: 'a-perfectly-fine-password' });

    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body.data.isNewAccount).toBe(true);

    // They can now sign in, and they are on the project.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'newdev@example.test', password: 'a-perfectly-fine-password' });

    expect(login.status).toBe(200);
    expect(login.body.data.organization.role).toBe('DEVELOPER');

    const projects = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(projects.body.data).toHaveLength(1);
  });

  it('refuses to reuse an accepted invitation', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);
    const token = randomToken();

    await prisma.invitation.create({
      data: {
        orgId: pm.organization.id,
        projectId: created.body.data.project.id,
        email: 'newdev@example.test',
        role: 'DEVELOPER',
        tokenHash: hashToken(token),
        invitedById: pm.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token, name: 'New Dev', password: 'a-perfectly-fine-password' });

    const second = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token, name: 'Someone Else', password: 'another-fine-password' });

    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('INVITATION_INVALID');
  });

  it('refuses an expired invitation', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);
    const token = randomToken();

    await prisma.invitation.create({
      data: {
        orgId: pm.organization.id,
        projectId: created.body.data.project.id,
        email: 'late@example.test',
        role: 'DEVELOPER',
        tokenHash: hashToken(token),
        invitedById: pm.user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token, name: 'Too Late', password: 'a-perfectly-fine-password' });

    expect(response.status).toBe(400);
  });

  it('does not change an existing user’s organisation role', async () => {
    // Inviting a developer to a project "as a client" must not demote them.
    const pm = await signUpAgency();
    const dev = await addTeamMember(pm.organization.id, 'dev@example.test', 'DEVELOPER');
    const created = await createProject(pm.accessToken);
    const token = randomToken();

    await prisma.invitation.create({
      data: {
        orgId: pm.organization.id,
        projectId: created.body.data.project.id,
        email: 'dev@example.test',
        role: 'CLIENT',
        tokenHash: hashToken(token),
        invitedById: pm.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await request(app).post('/api/v1/invitations/accept').send({ token });

    const membership = await prisma.membership.findFirst({ where: { userId: dev.userId } });
    expect(membership!.role).toBe('DEVELOPER');
  });

  it('supersedes an earlier invitation to the same email', async () => {
    // Two working links in one inbox is confusing, and doubles the window an
    // intercepted email stays useful.
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);
    const projectId = created.body.data.project.id as string;

    await inviteTo(pm.accessToken, projectId, 'twice@example.test');
    await inviteTo(pm.accessToken, projectId, 'twice@example.test');

    const live = await prisma.invitation.count({
      where: { projectId, email: 'twice@example.test' },
    });

    expect(live).toBe(1);
  });

  it('gives the same error for an invalid and a revoked token', async () => {
    const response = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token: randomToken(), name: 'Nobody', password: 'a-perfectly-fine-password' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVITATION_INVALID');
  });
});

describe('inviting someone who is already in the workspace', () => {
  /**
   * The failure this prevents: a project manager types a colleague's email into
   * the invite box, gets a "pending invitation" that will never resolve, and the
   * colleague sees nothing. They are already in the workspace — there is nothing
   * for them to accept.
   */
  it('adds them to the project immediately instead of emailing a link', async () => {
    const pm = await signUpAgency();
    const dev = await addTeamMember(pm.organization.id, 'dev@example.test', 'DEVELOPER');
    const created = await createProject(pm.accessToken);
    const projectId = created.body.data.project.id as string;

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/invitations`)
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ email: 'dev@example.test', role: 'DEVELOPER' });

    expect(response.status).toBe(201);
    expect(response.body.data.outcome).toBe('added');

    // No invitation row was created — nothing is left pending.
    expect(await prisma.invitation.count({ where: { projectId } })).toBe(0);

    // And they can see the project right away.
    const projects = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${dev.accessToken}`);

    expect(projects.body.data).toHaveLength(1);
    expect(projects.body.data[0].key).toBe('WEB');
  });

  it('still sends an invitation to someone with no account', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);

    const response = await request(app)
      .post(`/api/v1/projects/${created.body.data.project.id}/invitations`)
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ email: 'stranger@example.test', role: 'DEVELOPER' });

    expect(response.body.data.outcome).toBe('invited');
    expect(await prisma.invitation.count()).toBe(1);
  });

  it('clears a stale pending invitation when they are added directly', async () => {
    const pm = await signUpAgency();
    const created = await createProject(pm.accessToken);
    const projectId = created.body.data.project.id as string;

    // Invited before they had an account…
    await request(app)
      .post(`/api/v1/projects/${projectId}/invitations`)
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ email: 'later@example.test', role: 'DEVELOPER' });

    expect(await prisma.invitation.count({ where: { projectId } })).toBe(1);

    // …then they joined the workspace another way, and the PM tries again.
    await addTeamMember(pm.organization.id, 'later@example.test', 'DEVELOPER');

    await request(app)
      .post(`/api/v1/projects/${projectId}/invitations`)
      .set('Authorization', `Bearer ${pm.accessToken}`)
      .send({ email: 'later@example.test', role: 'DEVELOPER' });

    // The dangling invitation is gone rather than sitting in the pending list.
    expect(await prisma.invitation.count({ where: { projectId } })).toBe(0);
  });
});

describe('response shapes', () => {
  /**
   * The two crashes that shipped: `/projects` returned `_count.members` where
   * the screen read `memberIds.length`, and `/assignable` returned a nested
   * `memberships[0].role` where the UI wanted a flat `role`. Both sides
   * typechecked independently. Nothing compared them.
   *
   * These assertions are that comparison, written down.
   */
  it('serialises a project with every field a screen reads', async () => {
    const pm = await signUpAgency();
    await createProject(pm.accessToken);

    const list = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${pm.accessToken}`);

    const project = list.body.data[0];

    for (const field of [
      'id', 'workspaceId', 'key', 'name', 'description', 'status', 'priority',
      'startDate', 'endDate', 'leadId', 'memberIds', 'memberCount', 'progress',
      'visibility',
    ]) {
      expect(project, `missing ${field}`).toHaveProperty(field);
    }

    expect(Array.isArray(project.memberIds)).toBe(true);
    expect(typeof project.progress).toBe('number');
    expect(project.visibility).toHaveProperty('showTimeTracking');
  });

  it('serialises a person with a flat role, initials and colour', async () => {
    const pm = await signUpAgency();
    await createProject(pm.accessToken);

    const members = await request(app)
      .get('/api/v1/projects/WEB/members')
      .set('Authorization', `Bearer ${pm.accessToken}`);

    const person = members.body.data[0];

    for (const field of ['id', 'name', 'email', 'role', 'initials', 'avatarColor']) {
      expect(person, `missing ${field}`).toHaveProperty(field);
    }

    // Flat, not memberships[0].role.
    expect(person.role).toBe('PROJECT_MANAGER');
    expect(person.initials).toMatch(/^[A-Z]{1,2}$/);
    expect(person.avatarColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('separates who is on a project from who can be added', async () => {
    const pm = await signUpAgency();
    await addTeamMember(pm.organization.id, 'outsider@example.test', 'DEVELOPER');
    await createProject(pm.accessToken);

    const auth = { Authorization: `Bearer ${pm.accessToken}` };
    const members = await request(app).get('/api/v1/projects/WEB/members').set(auth);
    const assignable = await request(app).get('/api/v1/projects/WEB/assignable').set(auth);

    // Using `assignable` for the team page showed everyone except the team.
    expect(members.body.data.map((p: { email: string }) => p.email)).toEqual(['pm@example.test']);
    expect(assignable.body.data.map((p: { email: string }) => p.email)).toEqual([
      'outsider@example.test',
    ]);
  });

  it('applies the workspaceId, status and search filters', async () => {
    const pm = await signUpAgency();
    await createProject(pm.accessToken, 'WEB', 'FreshCart Web');
    await createProject(pm.accessToken, 'APP', 'Mobile App');

    const auth = { Authorization: `Bearer ${pm.accessToken}` };

    // These were accepted and silently ignored, so every filter on the
    // projects screen did nothing at all.
    const searched = await request(app).get('/api/v1/projects?search=Mobile').set(auth);
    const filtered = await request(app).get('/api/v1/projects?status=PLANNING').set(auth);
    const none = await request(app).get('/api/v1/projects?status=COMPLETED').set(auth);

    expect(searched.body.data).toHaveLength(1);
    expect(searched.body.data[0].key).toBe('APP');
    expect(filtered.body.data).toHaveLength(2);
    expect(none.body.data).toHaveLength(0);
  });
});
