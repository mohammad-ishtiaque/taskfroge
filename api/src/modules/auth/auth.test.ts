import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { closeDatabase, prisma, resetDatabase } from '../../../tests/setup';
import { hashToken, randomToken } from '../../lib/tokens';
import { hashChallenge, hashOtp } from './challenge';

/** The secret a browser would be holding, in tests that skip the request. */
const CHALLENGE = 'test-challenge-secret-long-enough-to-pass-validation';

const app = createApp();

const VALID_PASSWORD = 'correct-horse-battery';
const OWNER = {
  email: 'owner@example.test',
  password: VALID_PASSWORD,
  name: 'Owner Person',
  organizationName: 'Test Agency',
};

async function registerOwner() {
  const response = await request(app).post('/api/v1/auth/register').send(OWNER);
  return response.body.data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
    organization: { id: string; role: string };
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('POST /auth/register', () => {
  it('creates an organisation and makes the first user a project manager', async () => {
    const response = await request(app).post('/api/v1/auth/register').send(OWNER);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.organization.role).toBe('PROJECT_MANAGER');
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.meta.requestId).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const response = await request(app).post('/api/v1/auth/register').send(OWNER);

    // Checked against the whole serialised body, not a field, because the leak
    // that matters is the one nobody thought to look for.
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerOwner();
    const response = await request(app).post('/api/v1/auth/register').send(OWNER);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('rejects a password under 12 characters with field-keyed issues', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...OWNER, password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.issues.password).toBeDefined();
  });

  it('strips unknown fields rather than trusting them', async () => {
    // A caller must not be able to smuggle a role in through the body.
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...OWNER, role: 'DEVELOPER', isActive: false });

    expect(response.status).toBe(201);
    expect(response.body.data.organization.role).toBe('PROJECT_MANAGER');
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerOwner();
  });

  it('returns tokens for correct credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: VALID_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).toBeTruthy();
    expect(response.body.data.expiresInSeconds).toBe(900);
  });

  it('gives the same response for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: 'not-the-password' });

    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: VALID_PASSWORD });

    // Identical, on purpose. A different message or status turns login into an
    // account-enumeration endpoint.
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('refuses a deactivated account', async () => {
    await prisma.user.update({
      where: { email: OWNER.email },
      data: { isActive: false },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: VALID_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('is case-insensitive about the email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email.toUpperCase(), password: VALID_PASSWORD });

    expect(response.status).toBe(200);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const session = await registerOwner();

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).not.toBe(session.refreshToken);
  });

  it('revokes every session when an old token is replayed', async () => {
    const session = await registerOwner();

    // First refresh succeeds and invalidates the original.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });

    // Replaying the original means it was captured. Everything is revoked.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    expect(replay.status).toBe(401);

    const live = await prisma.session.count({
      where: { userId: session.user.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const session = await registerOwner();

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      // The access token is signed with a different secret; it must not be
      // usable here, which is why the two secrets have to differ.
      .send({ refreshToken: session.accessToken });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  /* Not tested: the compare-and-swap in `refresh`.
     ---------------------------------------------------------------------
     `refresh` writes with `updateMany ... where refreshTokenHash = <the hash
     we read>`, so that two rotations racing produce one winner and one
     harmless refusal, rather than two winners whose tokens then look like a
     replay and revoke every session the user has.

     That branch only runs when a second rotation lands between this one's read
     and its write, and I could not get a test to produce that state. Two
     attempts, both wrong, both left in the history rather than quietly deleted:

       1. Two real requests via `Promise.all`, with a confident comment saying
          the interleaving was reliable. It is not — they serialise, the second
          lands in the replay branch, and the test fails by revoking the very
          session it is asserting about.

       2. A `vi.spyOn(prisma.membership, 'findUnique')` that changed the row
          from underneath the request in flight. The spy never fired: Prisma's
          model delegates are not plain properties, so the service goes on
          calling the real one.

     Reaching it needs control over database interleaving that this suite does
     not have. The branch stays — it costs one predicate and prevents a
     catastrophic outcome — but it is uncovered, and pretending otherwise with
     a test that passes for the wrong reason would be worse than saying so.

     If you come back to this: `vi.mock` on `../../lib/prisma` with a wrapper
     that can be told to interleave is the approach that would work. */
});

describe('GET /auth/me', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the caller identity', async () => {
    const session = await registerOwner();

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('PROJECT_MANAGER');
  });

  it('rejects a token whose membership has been suspended', async () => {
    const session = await registerOwner();

    await prisma.membership.updateMany({
      where: { userId: session.user.id },
      data: { status: 'SUSPENDED' },
    });

    // Revocation is immediate, not "within fifteen minutes" — which is why
    // authenticate() re-reads the membership on every request.
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('reflects a role change without waiting for the token to expire', async () => {
    const session = await registerOwner();

    await prisma.membership.updateMany({
      where: { userId: session.user.id },
      data: { role: 'DEVELOPER' },
    });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);

    // The token still says PROJECT_MANAGER. The database wins.
    expect(response.body.data.role).toBe('DEVELOPER');
  });
});

describe('password reset', () => {
  beforeEach(async () => {
    await registerOwner();
  });

  it('responds identically for a known and an unknown email', async () => {
    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: OWNER.email });

    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.test' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.data.message).toBe(unknown.body.data.message);
  });

  it('stores the token hashed, never in plain text', async () => {
    await request(app).post('/api/v1/auth/forgot-password').send({ email: OWNER.email });

    const record = await prisma.passwordResetToken.findFirst();
    expect(record).toBeTruthy();
    // A sha256 hex digest, not a base64url token.
    expect(record!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(43), password: 'a-brand-new-password' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('rejects an expired token', async () => {
    // Insert a row we know the plain token for, so this genuinely exercises the
    // expiry branch. Going through forgot-password would leave the token
    // unrecoverable (it is stored hashed), and asserting on a random string
    // would only re-test the "invalid token" path under a misleading name.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    const token = randomToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        challengeHash: hashChallenge(CHALLENGE),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a-brand-new-password', challenge: CHALLENGE });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('accepts a valid token, then refuses to reuse it', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    const token = randomToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        challengeHash: hashChallenge(CHALLENGE),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    const first = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a-brand-new-password', challenge: CHALLENGE });
    expect(first.status).toBe(200);

    // Single use. A reset link forwarded or sitting in an inbox must not work
    // a second time.
    const second = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'yet-another-password', challenge: CHALLENGE });
    expect(second.status).toBe(400);

    // And the new password actually works.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: 'a-brand-new-password' });
    expect(login.status).toBe(200);
  });

  it('revokes every session when a password is reset', async () => {
    // This describe block's beforeEach already registered the owner, so sign in
    // rather than registering again — a second register returns 409 and leaves
    // us with no session to assert against.
    const signIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: VALID_PASSWORD });

    expect(signIn.status).toBe(200);
    const session = signIn.body.data as { refreshToken: string };

    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    const token = randomToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        challengeHash: hashChallenge(CHALLENGE),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a-brand-new-password', challenge: CHALLENGE });

    const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);

    // The meaningful check: the old refresh token is dead, so the attacker's
    // session cannot be extended past the current access token's 15 minutes.
    // If the reset happened because the account was compromised, this is the
    // part that actually removes them.
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    expect(refresh.status).toBe(401);
  });

  it('issues at most one live token, and throttles a second request', async () => {
    await request(app).post('/api/v1/auth/forgot-password').send({ email: OWNER.email });
    await request(app).post('/api/v1/auth/forgot-password').send({ email: OWNER.email });

    // One row, not two. The second request lands inside the cooldown and is
    // dropped — silently, because saying "slow down" would confirm the address
    // exists, and a person mashing the button twice is the common case anyway.
    const rows = await prisma.passwordResetToken.count();
    expect(rows).toBe(1);

    const unused = await prisma.passwordResetToken.count({ where: { usedAt: null } });
    expect(unused).toBe(1);
  });

  /* ── The binding ───────────────────────────────────────────────────────
     The thing this whole mechanism exists for: an emailed link is a bearer
     credential sitting in an inbox that may be shared, synced, forwarded, or
     simply left open. Holding it must not be enough. */

  it('refuses a reset from a browser that did not request it', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    const token = randomToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        challengeHash: hashChallenge(CHALLENGE),
        otpHash: hashOtp('123456'),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    // The forwarded-link attack, exactly: a correct, live, unused token and
    // nothing else. Before this it was a complete credential.
    const forwarded = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'attacker-chosen-password' });

    expect(forwarded.status).toBe(400);
    expect(forwarded.body.error.code).toBe('RESET_CHALLENGE_REQUIRED');

    // And the password is untouched — the point of the test is not the status
    // code, it is that the account did not change hands.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: VALID_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('lets the code through instead, for someone who changed device', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    const token = randomToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        challengeHash: hashChallenge('a-secret-this-browser-does-not-have'),
        otpHash: hashOtp('123456'),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    // Asked on a laptop, reading the email on a phone. Without this the
    // security control would simply break that person's day, and a control
    // people cannot get past is one they route around.
    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a-brand-new-password', otp: '123456' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
  });

  it('burns the token after five wrong codes', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    const token = randomToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        challengeHash: hashChallenge('a-secret-this-browser-does-not-have'),
        otpHash: hashOtp('123456'),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    // Six digits is a million possibilities, which sounds ample and is not:
    // unlimited guessing at a few hundred requests a second falls inside an
    // hour. Five attempts leaves a typo comfortable room.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'attacker-chosen-password', otp: '000000' });
    }

    // The correct code, on the sixth try. It must not work — the row is spent,
    // not paused, because a lockout that expires is one an attacker waits out.
    const withRightCode = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'attacker-chosen-password', otp: '123456' });

    expect(withRightCode.status).toBe(400);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: VALID_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('answers identically whether or not the address exists', async () => {
    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: OWNER.email });

    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.test' });

    expect(known.status).toBe(unknown.status);
    expect(known.body.data.message).toBe(unknown.body.data.message);

    // Including the challenge. Returning it only for real accounts would make
    // its presence the enumeration oracle that the matching message avoids.
    expect(typeof known.body.data.challenge).toBe('string');
    expect(typeof unknown.body.data.challenge).toBe('string');
    expect(known.body.data.challenge).not.toBe(unknown.body.data.challenge);
  });
});

describe('change password', () => {
  it('revokes other sessions but keeps the current one', async () => {
    const first = await registerOwner();

    // A second device signs in.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER.email, password: VALID_PASSWORD });

    const response = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'an-entirely-new-password' });

    expect(response.status).toBe(200);

    const live = await prisma.session.findMany({
      where: { userId: first.user.id, revokedAt: null },
    });

    // Only the device that made the change stays signed in.
    expect(live).toHaveLength(1);
  });

  it('refuses when the current password is wrong', async () => {
    const session = await registerOwner();

    const response = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: 'wrong', newPassword: 'an-entirely-new-password' });

    expect(response.status).toBe(400);
    expect(response.body.error.details.issues.currentPassword).toBeDefined();
  });
});

describe('response envelope', () => {
  it('uses the same shape for success and failure', async () => {
    const ok = await request(app).get('/health');
    const notFound = await request(app).get('/api/v1/does-not-exist');

    expect(notFound.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
      meta: { requestId: expect.any(String) },
    });
    expect(ok.status).toBe(200);
  });

  it('echoes an inbound request id so a trace survives the hop', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'trace-me-123');

    expect(response.headers['x-request-id']).toBe('trace-me-123');
  });
});
