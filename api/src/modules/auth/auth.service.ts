import type { Role } from '@prisma/client';
import { env } from '../../config/env';
import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password';
import {
  hashToken,
  randomToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/tokens';
import { queueEmail } from '../../lib/email';
import { passwordResetEmail } from './auth.emails';
import {
  MAX_OTP_ATTEMPTS,
  MAX_SENDS_PER_DAY,
  RESEND_COOLDOWN_MS,
  RESET_TTL_MS,
  createChallenge,
  createOtp,
  hashChallenge,
  hashOtp,
  safeEqual,
} from './challenge';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  timezone: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: AuthenticatedUser;
  organization: { id: string; name: string; slug: string; role: Role };
}

interface RequestContext {
  userAgent?: string;
  ipAddress?: string;
}

/** Creates an organisation and its first member, who is a Project Manager. */
export async function register(
  input: { email: string; password: string; name: string; organizationName: string },
  context: RequestContext,
): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw AppError.conflict('An account with that email already exists', {
      fields: ['email'],
    });
  }

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.organizationName);

  const { user, membership, org } = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.organizationName, slug },
    });

    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash },
    });

    // Whoever creates the workspace runs it. There is no separate admin role —
    // three roles, and the PM is the one with authority.
    const membership = await tx.membership.create({
      data: { orgId: org.id, userId: user.id, role: 'PROJECT_MANAGER' },
    });

    return { user, membership, org };
  });

  logger.info({ userId: user.id, orgId: org.id }, 'Organisation registered');

  return issueSession(
    { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
      locale: user.locale, timezone: user.timezone },
    { id: org.id, name: org.name, slug: org.slug, role: membership.role },
    context,
  );
}

export async function login(
  input: { email: string; password: string },
  context: RequestContext,
): Promise<AuthResult> {
  // Every active membership, not the first one. Which of them to open is a
  // decision made below, and it cannot be made by a `take: 1` in the query.
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        include: { org: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  // Always verify, even when the user does not exist, so a failed login takes
  // the same time either way. Response timing otherwise reveals which addresses
  // are registered.
  const valid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, input.password);

  if (!user || !valid) {
    logger.warn({ email: input.email, ip: context.ipAddress }, 'Failed sign-in attempt');
    throw AppError.invalidCredentials();
  }

  if (!user.isActive) {
    throw AppError.unauthenticated('This account has been deactivated', ErrorCode.ACCOUNT_INACTIVE);
  }

  /* Where they left off, falling back to the oldest.
     `lastOrgId` is a hint and is allowed to be stale — the membership it
     names may have been revoked since. Resolving it against the memberships
     we just loaded means a dead hint costs nothing and a live one is
     honoured, without a second query to find out which. */
  const membership =
    user.memberships.find((m) => m.orgId === user.lastOrgId) ?? user.memberships[0];

  if (!membership) {
    throw AppError.unauthenticated('You do not belong to a workspace', ErrorCode.ACCOUNT_INACTIVE);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastOrgId: membership.orgId },
  });

  logger.info({ userId: user.id, orgId: membership.orgId }, 'Sign-in successful');

  return issueSession(
    { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
      locale: user.locale, timezone: user.timezone },
    { id: membership.org.id, name: membership.org.name, slug: membership.org.slug,
      role: membership.role },
    context,
  );
}

/* ── Belonging to more than one workspace ──────────────────────────────────
   `login` takes the oldest active membership, which is right for the common
   case and silently wrong for the case that turned up in production: an
   agency invites a contractor who already runs their own TaskForge workspace.
   The invitation is accepted, the membership row is written, and the project
   never appears — because every query is scoped by the `orgId` in the access
   token, and that token was minted against the workspace they registered
   years earlier. The data was correct the whole time.

   So a session belongs to one organisation, and switching means getting a
   different session rather than editing the one you have. That is a
   deliberate choice: the role lives in the access token, and a person who is
   a manager in their own workspace is a developer in yours. Re-issuing from
   the target membership makes it impossible for the role to travel with
   them. Mutating the current session's `orgId` would leave a signed token
   claiming PROJECT_MANAGER against an organisation where they are not one,
   and it would be valid until it expired.                                  */

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  current: boolean;
}

/** Every workspace this person can sign into, and which one they are in. */
export async function listOrganizations(
  userId: string,
  currentOrgId: string,
): Promise<OrganizationSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { org: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((m) => ({
    id: m.org.id,
    name: m.org.name,
    slug: m.org.slug,
    role: m.role,
    current: m.org.id === currentOrgId,
  }));
}

/**
 * Move to another workspace by issuing a session for it.
 *
 * The old session is revoked rather than left open. Two live sessions for one
 * browser would both be refreshable, and the refresh rotation treats an
 * unexpected token as theft — the second one to rotate would look like a
 * replay and revoke everything. One browser, one session.
 */
export async function switchOrganization(
  userId: string,
  currentSessionId: string,
  targetOrgId: string,
  context: RequestContext,
): Promise<AuthResult> {
  const membership = await prisma.membership.findFirst({
    where: { userId, orgId: targetOrgId, status: 'ACTIVE' },
    include: {
      org: { select: { id: true, name: true, slug: true } },
      user: true,
    },
  });

  // Not found, not a member, and suspended all answer the same way. A
  // distinct "you are not a member of that workspace" would let anyone
  // holding a session enumerate which organisation ids exist.
  if (!membership) {
    throw AppError.notFound('Workspace');
  }

  if (!membership.user.isActive) {
    throw AppError.unauthenticated('This account has been deactivated', ErrorCode.ACCOUNT_INACTIVE);
  }

  const issued = await issueSession(
    {
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      avatarUrl: membership.user.avatarUrl,
      locale: membership.user.locale,
      timezone: membership.user.timezone,
    },
    {
      id: membership.org.id,
      name: membership.org.name,
      slug: membership.org.slug,
      // From the target membership, never from the caller's current token.
      role: membership.role,
    },
    context,
  );

  await prisma.$transaction([
    prisma.session.updateMany({
      where: { id: currentSessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ORG_SWITCHED' },
    }),
    // So tomorrow's sign-in opens here rather than sending them back.
    prisma.user.update({ where: { id: userId }, data: { lastOrgId: targetOrgId } }),
  ]);

  logger.info(
    { userId, from: currentSessionId, orgId: targetOrgId, role: membership.role },
    'Switched workspace',
  );

  return issued;
}

/**
 * Rotating refresh, with reuse detection.
 *
 * Each refresh invalidates its predecessor. If an older generation is
 * presented, either the token was stolen or the client is broken — and since we
 * cannot tell which, every session for that user is revoked.
 */
export async function refresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }> {
  const claims = verifyRefreshToken(refreshToken);

  const session = await prisma.session.findUnique({ where: { id: claims.sid } });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw AppError.unauthenticated('Your session has ended', ErrorCode.TOKEN_INVALID);
  }

  if (session.refreshTokenHash !== hashToken(refreshToken)) {
    logger.error(
      { userId: claims.sub, sessionId: claims.sid },
      'Refresh token reuse detected — revoking every session for this user',
    );

    await prisma.session.updateMany({
      where: { userId: claims.sub, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'TOKEN_REUSE_DETECTED' },
    });

    throw AppError.unauthenticated('Your session has ended', ErrorCode.TOKEN_INVALID);
  }

  const membership = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    include: { user: true },
  });

  if (!membership || membership.status !== 'ACTIVE' || !membership.user.isActive) {
    throw AppError.unauthenticated('Your access has been revoked', ErrorCode.ACCOUNT_INACTIVE);
  }

  const generation = session.generation + 1;
  const nextRefresh = signRefreshToken({
    sub: session.userId,
    orgId: session.orgId,
    sid: session.id,
    gen: generation,
  });

  // Compare-and-swap rather than a plain update.
  //
  // Read-then-write is not atomic, and two refreshes arriving together both
  // pass the check above before either writes. Both would be handed valid
  // tokens, one would overwrite the other, and the loser's brand-new token
  // would look like a replay the next time it was used — which revokes every
  // session the user has. Making the write conditional on the hash we read
  // means exactly one of them can win, and the loser fails here, harmlessly,
  // instead of poisoning the session for later.
  const rotated = await prisma.session.updateMany({
    where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
    data: {
      refreshTokenHash: hashToken(nextRefresh),
      generation,
      lastUsedAt: new Date(),
    },
  });

  if (rotated.count === 0) {
    // Someone rotated this session between our read and our write. Not theft —
    // the caller presented a token that was valid a moment ago — so no
    // revocation, just a refusal. The client retries with the pair that won.
    throw AppError.unauthenticated('Your session has ended', ErrorCode.TOKEN_INVALID);
  }

  const accessToken = signAccessToken({
    sub: session.userId,
    orgId: session.orgId,
    email: membership.user.email,
    role: membership.role,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresInSeconds: env.ACCESS_TOKEN_TTL_MIN * 60,
  };
}

export async function logout(sessionId: string): Promise<void> {
  // Logging out of an already-revoked session is a no-op, not an error.
  await prisma.session
    .updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT' },
    })
    .catch(() => undefined);
}

export async function logoutEverywhere(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT_ALL' },
  });

  return result.count;
}

/**
 * Starts a password reset.
 *
 * Returns the same result whether or not the address exists. An endpoint that
 * says "no account with that email" is an account enumeration tool.
 */
/**
 * Starts a reset, and hands back the challenge the browser must keep.
 *
 * The challenge is returned **whether or not the address exists**. It has to
 * be: a response that varies by whether an account is there is an enumeration
 * oracle, and this one is visible to anyone who can type an email address. For
 * an unknown address the secret simply matches nothing, and completion fails
 * later for the ordinary reason — there is no token.
 *
 * The web tier turns this into an httpOnly cookie on the requesting browser.
 * It has to happen there rather than here, because this API never speaks to
 * the browser directly — every call arrives from the web server on the user's
 * behalf, so a `Set-Cookie` written here would land on the wrong machine.
 */
export async function requestPasswordReset(
  email: string,
  resetUrlBase: string,
  context: { ip: string; agent: string },
): Promise<{ challenge: string }> {
  const challenge = createChallenge();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, isActive: true, locale: true },
  });

  if (!user || !user.isActive) {
    logger.info({ email }, 'Password reset requested for an unknown or inactive account');
    return { challenge: challenge.secret };
  }

  // Two caps, for two different abuses. The cooldown stops "resend" being a
  // way to spray codes at somebody's inbox; the daily cap stops the endpoint
  // being used to bury a real email under noise, or simply to harass.
  const [recent, today] = await Promise.all([
    prisma.passwordResetToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
      select: { id: true },
    }),
    prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60_000) } },
    }),
  ]);

  // Silently, in both cases. Telling the caller they are rate limited confirms
  // the address exists, which is the one thing this endpoint must not do.
  if (recent || today >= MAX_SENDS_PER_DAY) {
    logger.warn({ userId: user.id, today }, 'Password reset throttled');
    return { challenge: challenge.secret };
  }

  // Invalidate anything outstanding, so the newest link is the only live one.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomToken();
  const otp = createOtp();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      challengeHash: challenge.hash,
      otpHash: hashOtp(otp),
      requestIp: context.ip,
      requestAgent: context.agent,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  // Queued rather than awaited, and here it matters twice over. The response
  // to this endpoint is deliberately identical whether or not the address
  // exists — but a caller who times the two can tell them apart if one of them
  // waits for a mail server. Not waiting removes the difference and the hang
  // together. The log line below has always said "queued"; now it is true.
  queueEmail(
    passwordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl: `${resetUrlBase}?token=${token}`,
      otp,
      requestedFrom: `${context.agent} (${context.ip})`,
      locale: user.locale,
    }),
  );

  logger.info({ userId: user.id }, 'Password reset email queued');
  return { challenge: challenge.secret };
}

/**
 * Completes a reset. Single use, and every session is revoked afterwards.
 *
 * Two secrets are required, not one. The token proves you can read the
 * mailbox; the challenge proves you are the browser that asked. A forwarded
 * link carries the first and not the second, and a forwarded link is the
 * ordinary way this goes wrong — mailboxes are shared, synced, and left open.
 *
 * `otp` is the way through when the person genuinely moved devices: typing the
 * code from the email into the browser they are holding satisfies the same
 * requirement the cookie would have. It does not weaken the rule, because the
 * code is in the email and the email is what the token already proves access
 * to — what it removes is the assumption that both steps happen on one machine.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  proof: { challenge?: string; otp?: string } = {},
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, isActive: true } } },
  });

  if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
    throw new AppError({
      code: ErrorCode.RESET_TOKEN_INVALID,
      status: 400,
      message: 'This reset link is invalid or has expired. Please request a new one.',
    });
  }

  // Attempts are counted before anything is compared, so a request that
  // crashes or is abandoned still costs the attacker one of their five.
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await burn(record.id);
    throw new AppError({
      code: ErrorCode.RESET_TOKEN_INVALID,
      status: 400,
      message: 'Too many attempts. Please request a new reset link.',
    });
  }

  const sameBrowser =
    proof.challenge !== undefined && safeEqual(hashChallenge(proof.challenge), record.challengeHash);

  const codeMatches =
    proof.otp !== undefined &&
    record.otpHash !== null &&
    safeEqual(hashOtp(proof.otp), record.otpHash);

  if (!sameBrowser && !codeMatches) {
    // Counted rather than burned outright: a person who mistypes one digit of
    // a six-digit code should not have to start again, and five tries reduces
    // a guesser to one chance in two hundred thousand per issued code.
    await prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });

    logger.warn({ userId: record.userId }, 'Password reset attempted without valid proof');

    throw new AppError({
      code: ErrorCode.RESET_CHALLENGE_REQUIRED,
      status: 400,
      message:
        'This link was opened in a different browser from the one that requested it. ' +
        'Enter the 6-digit code from the email to continue.',
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Anyone who had a session with the old password loses it. If the reset was
    // triggered because the account was compromised, this is the part that
    // actually removes the attacker.
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
    }),
  ]);

  logger.info({ userId: record.userId, via: sameBrowser ? 'challenge' : 'otp' }, 'Password reset completed');
}

/** Spends a token without using it, so a burned row cannot be retried. */
async function burn(id: string): Promise<void> {
  await prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
}

/** Changing a password while signed in. Keeps the current session alive. */
export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw AppError.validation('Your current password is not correct', {
      issues: { currentPassword: ['Incorrect password'] },
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
    }),
  ]);

  logger.info({ userId }, 'Password changed');
}

// ── internals ───────────────────────────────────────────────────────────────

async function issueSession(
  user: AuthenticatedUser,
  org: { id: string; name: string; slug: string; role: Role },
  context: RequestContext,
): Promise<AuthResult> {
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      orgId: org.id,
      refreshTokenHash: '', // replaced below, once the id it signs over exists
      expiresAt,
      userAgent: context.userAgent?.slice(0, 512),
      ipAddress: context.ipAddress,
    },
  });

  const refreshToken = signRefreshToken({
    sub: user.id,
    orgId: org.id,
    sid: session.id,
    gen: 1,
  });

  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: hashToken(refreshToken) },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    orgId: org.id,
    email: user.email,
    role: org.role,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: env.ACCESS_TOKEN_TTL_MIN * 60,
    user,
    organization: org,
  };
}

async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!taken) return candidate;
  }

  return `${base}-${randomToken(4)}`;
}
