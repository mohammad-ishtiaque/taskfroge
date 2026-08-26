import { env } from '../../config/env';
import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { withTransaction } from '../../lib/db';
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
import {
  Role,
  User,
  Organization,
  Membership,
  Session,
  PasswordResetToken,
  UserDocument,
  OrganizationDocument,
} from '../../models';

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
  const existing = await User.findOne({ email: input.email }).select('id');

  if (existing) {
    throw AppError.conflict('An account with that email already exists', {
      fields: ['email'],
    });
  }

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.organizationName);

  const { user, membership, org } = await withTransaction(async (session) => {
    const [orgDoc] = await Organization.create(
      [{ name: input.organizationName, slug }],
      { session }
    );

    const [userDoc] = await User.create(
      [{ email: input.email, name: input.name, passwordHash }],
      { session }
    );

    if (!orgDoc || !userDoc) throw AppError.internal('Failed to create user or organization');

    const [membershipDoc] = await Membership.create(
      [{ orgId: orgDoc.id, userId: userDoc.id, role: 'PROJECT_MANAGER' }],
      { session }
    );

    if (!membershipDoc) throw AppError.internal('Failed to create membership');

    return { user: userDoc, membership: membershipDoc, org: orgDoc };
  });

  if (!user || !org || !membership) throw AppError.internal('Registration failed');

  logger.info({ userId: user.id, orgId: org.id }, 'Organisation registered');

  return issueSession(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      locale: user.locale,
      timezone: user.timezone,
    },
    { id: org.id, name: org.name, slug: org.slug, role: membership.role },
    context,
  );
}

export async function login(
  input: { email: string; password: string },
  context: RequestContext,
): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email });

  const valid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, input.password);

  if (!user || !valid) {
    logger.warn({ email: input.email, ip: context.ipAddress }, 'Failed sign-in attempt');
    throw AppError.invalidCredentials();
  }

  if (!user.isActive) {
    throw AppError.unauthenticated('This account has been deactivated', ErrorCode.ACCOUNT_INACTIVE);
  }

  const memberships = await Membership.find({ userId: user.id, status: 'ACTIVE' })
    .populate<{ orgId: OrganizationDocument }>('orgId')
    .sort({ createdAt: 1 });

  const membership =
    memberships.find((m) => m.orgId.id === user.lastOrgId?.toString()) ?? memberships[0];

  if (!membership || !membership.orgId) {
    throw AppError.unauthenticated('You do not belong to a workspace', ErrorCode.ACCOUNT_INACTIVE);
  }

  const org = membership.orgId;

  await User.findByIdAndUpdate(user.id, {
    lastLoginAt: new Date(),
    lastOrgId: org.id,
  });

  logger.info({ userId: user.id, orgId: org.id }, 'Sign-in successful');

  return issueSession(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      locale: user.locale,
      timezone: user.timezone,
    },
    { id: org.id, name: org.name, slug: org.slug, role: membership.role },
    context,
  );
}

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
  const memberships = await Membership.find({ userId, status: 'ACTIVE' })
    .populate<{ orgId: OrganizationDocument }>('orgId', 'id name slug')
    .sort({ createdAt: 1 });

  return memberships.map((m) => {
    const org = m.orgId;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      role: m.role,
      current: org.id === currentOrgId,
    };
  });
}

/**
 * Move to another workspace by issuing a session for it.
 */
export async function switchOrganization(
  userId: string,
  currentSessionId: string,
  targetOrgId: string,
  context: RequestContext,
): Promise<AuthResult> {
  const membership = await Membership.findOne({
    userId,
    orgId: targetOrgId,
    status: 'ACTIVE',
  })
    .populate<{ orgId: OrganizationDocument }>('orgId', 'id name slug')
    .populate<{ userId: UserDocument }>('userId');

  if (!membership || !membership.orgId || !membership.userId) {
    throw AppError.notFound('Workspace');
  }

  const user = membership.userId;
  const org = membership.orgId;

  if (!user.isActive) {
    throw AppError.unauthenticated('This account has been deactivated', ErrorCode.ACCOUNT_INACTIVE);
  }

  const issued = await issueSession(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      locale: user.locale,
      timezone: user.timezone,
    },
    {
      id: org.id,
      name: org.name,
      slug: org.slug,
      role: membership.role,
    },
    context,
  );

  await withTransaction(async (session) => {
    await Session.updateOne(
      { _id: currentSessionId, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'ORG_SWITCHED' },
      { session }
    );
    await User.updateOne({ _id: userId }, { lastOrgId: targetOrgId }, { session });
  });

  logger.info(
    { userId, from: currentSessionId, orgId: targetOrgId, role: membership.role },
    'Switched workspace',
  );

  return issued;
}

/**
 * Rotating refresh, with reuse detection.
 */
export async function refresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }> {
  const claims = verifyRefreshToken(refreshToken);

  const session = await Session.findById(claims.sid);

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw AppError.unauthenticated('Your session has ended', ErrorCode.TOKEN_INVALID);
  }

  if (session.refreshTokenHash !== hashToken(refreshToken)) {
    logger.error(
      { userId: claims.sub, sessionId: claims.sid },
      'Refresh token reuse detected — revoking every session for this user',
    );

    await Session.updateMany(
      { userId: claims.sub, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'TOKEN_REUSE_DETECTED' },
    );

    throw AppError.unauthenticated('Your session has ended', ErrorCode.TOKEN_INVALID);
  }

  const membership = await Membership.findOne({
    orgId: session.orgId,
    userId: session.userId,
  }).populate<{ userId: UserDocument }>('userId');

  const user = membership?.userId;

  if (!membership || membership.status !== 'ACTIVE' || !user || !user.isActive) {
    throw AppError.unauthenticated('Your access has been revoked', ErrorCode.ACCOUNT_INACTIVE);
  }

  const generation = session.generation + 1;
  const nextRefresh = signRefreshToken({
    sub: session.userId.toString(),
    orgId: session.orgId.toString(),
    sid: session.id,
    gen: generation,
  });

  const rotated = await Session.updateOne(
    { _id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
    {
      refreshTokenHash: hashToken(nextRefresh),
      generation,
      lastUsedAt: new Date(),
    },
  );

  if (rotated.modifiedCount === 0) {
    throw AppError.unauthenticated('Your session has ended', ErrorCode.TOKEN_INVALID);
  }

  const accessToken = signAccessToken({
    sub: session.userId.toString(),
    orgId: session.orgId.toString(),
    email: user.email,
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
  await Session.updateOne(
    { _id: sessionId, revokedAt: null },
    { revokedAt: new Date(), revokedReason: 'USER_LOGOUT' },
  ).catch(() => undefined);
}

export async function logoutEverywhere(userId: string): Promise<number> {
  const result = await Session.updateMany(
    { userId, revokedAt: null },
    { revokedAt: new Date(), revokedReason: 'USER_LOGOUT_ALL' },
  );

  return result.modifiedCount;
}

export async function requestPasswordReset(
  email: string,
  resetUrlBase: string,
  context: { ip: string; agent: string },
): Promise<{ challenge: string }> {
  const challenge = createChallenge();

  const user = await User.findOne({ email }).select('id email name isActive locale');

  if (!user || !user.isActive) {
    logger.info({ email }, 'Password reset requested for an unknown or inactive account');
    return { challenge: challenge.secret };
  }

  const [recent, today] = await Promise.all([
    PasswordResetToken.findOne({
      userId: user.id,
      createdAt: { $gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    }).select('id'),
    PasswordResetToken.countDocuments({
      userId: user.id,
      createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60_000) },
    }),
  ]);

  if (recent || today >= MAX_SENDS_PER_DAY) {
    logger.warn({ userId: user.id, today }, 'Password reset throttled');
    return { challenge: challenge.secret };
  }

  await PasswordResetToken.updateMany(
    { userId: user.id, usedAt: null },
    { usedAt: new Date() },
  );

  const token = randomToken();
  const otp = createOtp();

  await PasswordResetToken.create({
    userId: user.id,
    tokenHash: hashToken(token),
    challengeHash: challenge.hash,
    otpHash: hashOtp(otp),
    requestIp: context.ip,
    requestAgent: context.agent,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

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

export async function resetPassword(
  token: string,
  newPassword: string,
  proof: { challenge?: string; otp?: string } = {},
): Promise<void> {
  const record = await PasswordResetToken.findOne({ tokenHash: hashToken(token) }).populate<{
    userId: UserDocument;
  }>('userId', 'id isActive');

  const user = record?.userId;

  if (!record || record.usedAt || record.expiresAt < new Date() || !user || !user.isActive) {
    throw new AppError({
      code: ErrorCode.RESET_TOKEN_INVALID,
      status: 400,
      message: 'This reset link is invalid or has expired. Please request a new one.',
    });
  }

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
    record.otpHash != null &&
    safeEqual(hashOtp(proof.otp), record.otpHash);

  if (!sameBrowser && !codeMatches) {
    await PasswordResetToken.updateOne({ _id: record.id }, { $inc: { attempts: 1 } });

    logger.warn({ userId: user.id }, 'Password reset attempted without valid proof');

    throw new AppError({
      code: ErrorCode.RESET_CHALLENGE_REQUIRED,
      status: 400,
      message:
        'This link was opened in a different browser from the one that requested it. ' +
        'Enter the 6-digit code from the email to continue.',
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (session) => {
    await User.updateOne({ _id: user.id }, { passwordHash }, { session });
    await PasswordResetToken.updateOne({ _id: record.id }, { usedAt: new Date() }, { session });
    await Session.updateMany(
      { userId: user.id, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      { session }
    );
  });

  logger.info({ userId: user.id, via: sameBrowser ? 'challenge' : 'otp' }, 'Password reset completed');
}

async function burn(id: string): Promise<void> {
  await PasswordResetToken.updateOne({ _id: id }, { usedAt: new Date() });
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await User.findById(userId).select('passwordHash');

  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw AppError.validation('Your current password is not correct', {
      issues: { currentPassword: ['Incorrect password'] },
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (session) => {
    await User.updateOne({ _id: userId }, { passwordHash }, { session });
    await Session.updateMany(
      { userId, revokedAt: null, _id: { $ne: currentSessionId } },
      { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      { session }
    );
  });

  logger.info({ userId }, 'Password changed');
}

async function issueSession(
  user: AuthenticatedUser,
  org: { id: string; name: string; slug: string; role: Role },
  context: RequestContext,
): Promise<AuthResult> {
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  const sessionDoc = await Session.create({
    userId: user.id,
    orgId: org.id,
    refreshTokenHash: 'pending',   // replaced immediately below; '' fails Mongoose's required check
    expiresAt,
    userAgent: context.userAgent?.slice(0, 512),
    ipAddress: context.ipAddress,
  });

  const refreshToken = signRefreshToken({
    sub: user.id,
    orgId: org.id,
    sid: sessionDoc.id,
    gen: 1,
  });

  await Session.findByIdAndUpdate(sessionDoc.id, {
    refreshTokenHash: hashToken(refreshToken),
  });

  const accessToken = signAccessToken({
    sub: user.id,
    orgId: org.id,
    email: user.email,
    role: org.role,
    sid: sessionDoc.id,
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
    const taken = await Organization.findOne({ slug: candidate }).select('id');

    if (!taken) return candidate;
  }

  return `${base}-${randomToken(4)}`;
}
