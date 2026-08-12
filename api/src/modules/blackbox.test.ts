import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app';
import { closeDatabase, prisma, resetDatabase } from '../../tests/setup';

/* ==========================================================================
   Black box
   --------------------------------------------------------------------------
   Written from outside, knowing only the HTTP surface. Nothing here reaches
   into a service or asserts on an internal — every check is something a
   stranger with curl could perform.

   The other suites ask "does the happy path work". This one asks the two
   questions an attacker asks instead:

     · what happens when I send something you did not expect
     · what can I reach that is not mine

   Nothing in here should ever need changing when the implementation changes.
   If one of these starts failing, the behaviour visible to the outside world
   changed, and that is exactly what we want to hear about.
   ========================================================================== */

const app = createApp();
const PASSWORD = 'correct-horse-battery';

async function agency(email: string, org: string) {
  const res = await request(app).post('/api/v1/auth/register').send({
    email,
    password: PASSWORD,
    name: 'Owner',
    organizationName: org,
  });

  const token = res.body.data.accessToken as string;
  const auth = { Authorization: `Bearer ${token}` };

  const ws = await request(app)
    .post('/api/v1/workspaces')
    .set(auth)
    .send({ name: org, clientName: `${org} Ltd` });

  const project = await request(app)
    .post('/api/v1/projects')
    .set(auth)
    .send({ workspaceId: ws.body.data.id, key: org.slice(0, 3).toUpperCase(), name: `${org} site` });

  return {
    token,
    auth,
    workspaceSlug: ws.body.data.slug as string,
    projectKey: project.body.data.project.key as string,
    orgId: res.body.data.organization.id as string,
    userId: res.body.data.user.id as string,
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

/* ── Input nobody expected ──────────────────────────────────────────────── */

describe('malformed and hostile input', () => {
  it('answers every unauthenticated write with 401, never a stack trace', async () => {
    const writes: [string, string][] = [
      ['post', '/api/v1/workspaces'],
      ['post', '/api/v1/projects'],
      ['post', '/api/v1/projects/WEB/tasks'],
      ['patch', '/api/v1/tasks/WEB-1'],
      ['patch', '/api/v1/tasks/WEB-1/status'],
      ['post', '/api/v1/tasks/WEB-1/comments'],
      ['post', '/api/v1/notifications/read'],
    ];

    for (const [method, path] of writes) {
      const res = await (method === 'post'
        ? request(app).post(path)
        : request(app).patch(path)
      ).send({ anything: true });

      expect(res.status, `${method} ${path}`).toBe(401);
      // A body that leaks a stack trace tells an attacker the framework, the
      // file layout and often the ORM version.
      expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
    }
  });

  it('rejects a malformed bearer token without crashing', async () => {
    for (const value of ['Bearer', 'Bearer ', 'Bearer nonsense', 'Basic abc', 'null', '']) {
      const res = await request(app).get('/api/v1/workspaces').set({ Authorization: value });
      expect([401, 403], `header "${value}"`).toContain(res.status);
    }
  });

  it('rejects a body that is not an object', async () => {
    const a = await agency('a@example.test', 'Alpha');

    for (const body of ['"a string"', '[1,2,3]', 'null', '42']) {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set(a.auth)
        .set('Content-Type', 'application/json')
        .send(body);

      expect([400, 422], `body ${body}`).toContain(res.status);
    }
  });

  it('refuses an oversized payload rather than absorbing it', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const res = await request(app)
      .post('/api/v1/workspaces')
      .set(a.auth)
      .send({ name: 'x'.repeat(200_000), clientName: 'y' });

    // 413 from the body-size limit, or 400 from validation. Either is fine;
    // a 201 would mean the limit does nothing.
    expect([400, 413, 422]).toContain(res.status);
  });

  it('treats SQL and script payloads as ordinary text', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const nasty = [
      "'; DROP TABLE \"Task\"; --",
      '<script>alert(1)</script>',
      '${process.env.JWT_SECRET}',
      '{{constructor.constructor("return process")()}}',
    ];

    for (const title of nasty) {
      const res = await request(app)
        .post(`/api/v1/projects/${a.projectKey}/tasks`)
        .set(a.auth)
        .send({ title });

      expect(res.status, title).toBe(201);
      // Stored verbatim, escaped on the way out. Not sanitised on the way in:
      // a title that legitimately contains `<` should survive a round trip.
      expect(res.body.data.title).toBe(title);
    }

    // The table is still there, which it would not be if the first one ran.
    const after = await request(app).get(`/api/v1/projects/${a.projectKey}/tasks`).set(a.auth);
    expect(after.body.data).toHaveLength(nasty.length);
  });

  it('rejects out-of-range and wrong-typed numbers', async () => {
    const a = await agency('a@example.test', 'Alpha');

    // NaN and Infinity are deliberately absent: `JSON.stringify` turns both
    // into `null`, so they arrive as "field omitted" and are correctly
    // accepted. Asserting otherwise would be testing JSON, not the API.
    for (const estimateHours of [-1, 99_999, 'sixteen', {}, []]) {
      const res = await request(app)
        .post(`/api/v1/projects/${a.projectKey}/tasks`)
        .set(a.auth)
        .send({ title: 'Bad estimate', estimateHours });

      expect([400, 422], `estimate ${JSON.stringify(estimateHours)}`).toContain(res.status);
    }
  });

  it('rejects a date that is not a date', async () => {
    const a = await agency('a@example.test', 'Alpha');

    for (const dueDate of ['tomorrow', '2026-13-45', '31/12/2026', '2026-02-30T99:99:99Z']) {
      const res = await request(app)
        .post(`/api/v1/projects/${a.projectKey}/tasks`)
        .set(a.auth)
        .send({ title: 'Bad date', dueDate });

      expect([400, 422], `date ${dueDate}`).toContain(res.status);
    }
  });

  it('rejects an unknown enum value instead of storing it', async () => {
    const a = await agency('a@example.test', 'Alpha');

    // `status` is not on the create schema at all — a task always starts in
    // TODO — so it is stripped rather than rejected. That is correct, and
    // asserting a 400 was my mistake.
    for (const [field, value] of [
      ['type', 'EPIC'],
      ['priority', 'CRITICAL'],
    ] as [string, string][]) {
      const res = await request(app)
        .post(`/api/v1/projects/${a.projectKey}/tasks`)
        .set(a.auth)
        .send({ title: 'Bad enum', [field]: value });

      expect([400, 422], `${field}=${value}`).toContain(res.status);
    }
  });

  it('ignores fields it was not asked for rather than trusting them', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const res = await request(app)
      .post(`/api/v1/projects/${a.projectKey}/tasks`)
      .set(a.auth)
      .send({
        title: 'Ordinary task',
        // Every one of these would be a privilege escalation if honoured.
        id: '00000000-0000-4000-8000-000000000000',
        key: 'HACKED-1',
        orgId: '00000000-0000-4000-8000-000000000001',
        clientVisible: false,
        loggedHours: 999,
        createdAt: '1999-01-01T00:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.key).not.toBe('HACKED-1');
    expect(res.body.data.orgId).toBe(a.orgId);
    expect(Number(res.body.data.loggedHours)).toBe(0);
  });
});

/* ── Reaching what is not yours ─────────────────────────────────────────── */

describe('tenant isolation, from outside', () => {
  it('never lets one agency read another agency’s anything', async () => {
    const a = await agency('a@example.test', 'Alpha');
    const b = await agency('b@example.test', 'Bravo');

    await request(app)
      .post(`/api/v1/projects/${a.projectKey}/tasks`)
      .set(a.auth)
      .send({ title: 'Alpha internal work' });

    // Bravo, holding a perfectly valid token, asking for Alpha's resources.
    const attempts = [
      `/api/v1/workspaces/${a.workspaceSlug}`,
      `/api/v1/projects/${a.projectKey}`,
      `/api/v1/projects/${a.projectKey}/tasks`,
      `/api/v1/projects/${a.projectKey}/members`,
      `/api/v1/projects/${a.projectKey}/stats`,
      `/api/v1/projects/${a.projectKey}/activity`,
      `/api/v1/tasks/${a.projectKey}-1`,
      `/api/v1/tasks/${a.projectKey}-1/comments`,
    ];

    for (const path of attempts) {
      const res = await request(app).get(path).set(b.auth);

      expect([403, 404], path).toContain(res.status);
      // And whatever the status, no trace of Alpha's data in the body.
      expect(JSON.stringify(res.body), path).not.toContain('Alpha internal work');
    }
  });

  it('never lets one agency write into another’s project', async () => {
    const a = await agency('a@example.test', 'Alpha');
    const b = await agency('b@example.test', 'Bravo');

    const writes = [
      request(app).post(`/api/v1/projects/${a.projectKey}/tasks`).set(b.auth).send({ title: 'x' }),
      request(app).patch(`/api/v1/projects/${a.projectKey}`).set(b.auth).send({ name: 'Hijacked' }),
      request(app).put(`/api/v1/projects/${a.projectKey}/visibility`).set(b.auth).send({ preset: 'OPEN' }),
      request(app).patch(`/api/v1/workspaces/${a.workspaceSlug}`).set(b.auth).send({ name: 'Hijacked' }),
    ];

    for (const res of await Promise.all(writes)) {
      expect([403, 404]).toContain(res.status);
    }

    const untouched = await request(app).get(`/api/v1/projects/${a.projectKey}`).set(a.auth);
    expect(untouched.body.data.name).not.toBe('Hijacked');
  });

  it('does not confirm existence through the shape of its refusal', async () => {
    const a = await agency('a@example.test', 'Alpha');
    const b = await agency('b@example.test', 'Bravo');

    const real = await request(app).get(`/api/v1/projects/${a.projectKey}`).set(b.auth);
    const imaginary = await request(app).get('/api/v1/projects/ZZZ').set(b.auth);

    // A 404 for one and a 403 for the other tells you which keys are real.
    expect(real.status).toBe(imaginary.status);
    expect(real.body.error.code).toBe(imaginary.body.error.code);
  });

  it('does not leak whether an email has an account', async () => {
    await agency('known@example.test', 'Alpha');

    const known = await request(app).post('/api/v1/auth/forgot-password').send({
      email: 'known@example.test',
    });
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({
      email: 'nobody@example.test',
    });

    expect(known.status).toBe(unknown.status);

    // Compared field by field rather than whole-body, because one field is
    // *supposed* to differ: the challenge is a fresh random secret per request,
    // so two calls can never produce identical bodies. Asserting deep equality
    // was the test being wrong, not the endpoint.
    //
    // What actually has to match is everything an attacker could read a signal
    // from — the status, the wording, the set of keys, and the shape of the
    // challenge. A challenge returned only for real accounts, or a longer one
    // for real accounts, would be the oracle the identical message avoids.
    expect(Object.keys(known.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
    expect(known.body.data.message).toBe(unknown.body.data.message);

    const knownChallenge = known.body.data.challenge as string;
    const unknownChallenge = unknown.body.data.challenge as string;

    expect(typeof knownChallenge).toBe('string');
    expect(knownChallenge.length).toBe(unknownChallenge.length);
    expect(knownChallenge).not.toBe(unknownChallenge);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await agency('known@example.test', 'Alpha');

    const wrongPassword = await request(app).post('/api/v1/auth/login').send({
      email: 'known@example.test',
      password: 'not-the-password',
    });
    const noSuchUser = await request(app).post('/api/v1/auth/login').send({
      email: 'nobody@example.test',
      password: 'not-the-password',
    });

    expect(wrongPassword.status).toBe(noSuchUser.status);
    expect(wrongPassword.body.error.code).toBe(noSuchUser.body.error.code);
  });
});

/* ── Boundaries and edges ───────────────────────────────────────────────── */

describe('boundaries', () => {
  it('accepts the longest legal title and refuses one character more', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const atLimit = await request(app)
      .post(`/api/v1/projects/${a.projectKey}/tasks`)
      .set(a.auth)
      .send({ title: 'x'.repeat(200) });

    const overLimit = await request(app)
      .post(`/api/v1/projects/${a.projectKey}/tasks`)
      .set(a.auth)
      .send({ title: 'x'.repeat(201) });

    expect(atLimit.status).toBe(201);
    expect([400, 422]).toContain(overLimit.status);
  });

  it('refuses a title that is only whitespace', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const res = await request(app)
      .post(`/api/v1/projects/${a.projectKey}/tasks`)
      .set(a.auth)
      .send({ title: '   \n\t  ' });

    expect([400, 422]).toContain(res.status);
  });

  it('keeps unicode and emoji intact through a round trip', async () => {
    const a = await agency('a@example.test', 'Alpha');
    const title = 'ফিক্স করুন — إصلاح 🔧 naïve résumé';

    const created = await request(app)
      .post(`/api/v1/projects/${a.projectKey}/tasks`)
      .set(a.auth)
      .send({ title });

    const read = await request(app)
      .get(`/api/v1/tasks/${created.body.data.key}`)
      .set(a.auth);

    expect(read.body.data.title).toBe(title);
  });

  it('finds a task by lower-case key', async () => {
    const a = await agency('a@example.test', 'Alpha');
    await request(app).post(`/api/v1/projects/${a.projectKey}/tasks`).set(a.auth).send({ title: 'x' });

    // People paste keys from chat in whatever case they were typed.
    const lower = await request(app)
      .get(`/api/v1/tasks/${a.projectKey.toLowerCase()}-1`)
      .set(a.auth);

    expect(lower.status).toBe(200);
  });

  it('returns an empty list rather than an error when there is nothing', async () => {
    const a = await agency('a@example.test', 'Alpha');

    for (const path of [
      `/api/v1/projects/${a.projectKey}/tasks`,
      `/api/v1/projects/${a.projectKey}/activity`,
      '/api/v1/tasks/mine',
    ]) {
      const res = await request(app).get(path).set(a.auth);
      expect(res.status, path).toBe(200);
      expect(Array.isArray(res.body.data), path).toBe(true);
    }
  });

  it('survives an unknown query parameter', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const res = await request(app)
      .get(`/api/v1/projects/${a.projectKey}/tasks?sortBy=DROP&limit=-1&page=abc&x[]=1`)
      .set(a.auth);

    expect([200, 400, 422]).toContain(res.status);
  });

  it('does not double-create when the same request arrives twice', async () => {
    const a = await agency('a@example.test', 'Alpha');

    // Two identical creates are two tasks — that is correct and expected.
    // What must not happen is one of them failing on a key collision.
    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/projects/${a.projectKey}/tasks`).set(a.auth).send({ title: 'Same' }),
      request(app).post(`/api/v1/projects/${a.projectKey}/tasks`).set(a.auth).send({ title: 'Same' }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.key).not.toBe(second.body.data.key);
  });
});

/* ── Session behaviour ──────────────────────────────────────────────────── */

describe('sessions, from outside', () => {
  it('stops accepting a token after the session is revoked', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const before = await request(app).get('/api/v1/auth/me').set(a.auth);
    expect(before.status).toBe(200);

    await request(app).post('/api/v1/auth/logout-all').set(a.auth).send({});

    // The token is still cryptographically valid. The session behind it is not.
    const after = await request(app).get('/api/v1/auth/me').set(a.auth);
    expect(after.status).toBe(401);
  });

  it('stops accepting a token once the account is deactivated', async () => {
    const a = await agency('a@example.test', 'Alpha');

    await prisma.user.update({ where: { id: a.userId }, data: { isActive: false } });

    const res = await request(app).get('/api/v1/auth/me').set(a.auth);
    expect(res.status).toBe(401);
  });

  it('answers an unknown path with 404 and a normal envelope', async () => {
    const a = await agency('a@example.test', 'Alpha');

    const res = await request(app).get('/api/v1/there-is-no-such-thing').set(a.auth);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error.code');
    expect(res.body).toHaveProperty('meta.requestId');
  });
});
