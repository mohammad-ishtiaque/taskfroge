import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { AppError, ErrorCode } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../lib/tokens';

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  role: Role;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Verifies the access token and re-checks the membership.
 *
 * Two lookups on every request, both deliberate.
 *
 * **Membership**, so removing someone from the organisation takes effect now
 * rather than when their token expires.
 *
 * **Session**, for the same reason and a sharper one: "log out everywhere" is
 * what a person does when they think a device is compromised, and it has to
 * mean it. Without this check the revoked token kept working for the rest of
 * its fifteen minutes — which is the entire window an attacker needs.
 *
 * Two indexed queries is a fair price for revocation being immediate.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req);
    if (!token) throw AppError.unauthenticated('Missing Authorization header');

    const claims = verifyAccessToken(token);

    const [membership, session] = await Promise.all([
      prisma.membership.findUnique({
        where: { orgId_userId: { orgId: claims.orgId, userId: claims.sub } },
        select: { role: true, status: true, user: { select: { isActive: true } } },
      }),
      prisma.session.findUnique({
        where: { id: claims.sid },
        select: { revokedAt: true, userId: true },
      }),
    ]);

    if (!membership || membership.status !== 'ACTIVE' || !membership.user.isActive) {
      throw AppError.unauthenticated(
        'Your access has been revoked',
        ErrorCode.ACCOUNT_INACTIVE,
      );
    }

    // A session that was revoked, deleted, or belongs to someone else.
    // The last of those would mean a forged claim, which the signature should
    // already prevent — checked anyway, because "should" is doing a lot of
    // work in that sentence.
    if (!session || session.revokedAt || session.userId !== claims.sub) {
      throw AppError.unauthenticated('This session has ended. Sign in again.');
    }

    req.auth = {
      userId: claims.sub,
      orgId: claims.orgId,
      email: claims.email,
      // The stored role wins over the token's copy. A role changed five minutes
      // ago should take effect now, not when the token expires.
      role: membership.role,
      sessionId: claims.sid,
    };

    next();
  } catch (error) {
    next(error);
  }
}

function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;

  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;

  return value.trim();
}

/** Convenience for handlers that have already passed `authenticate`. */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw AppError.internal('requireAuth() used on an unauthenticated route');
  return req.auth;
}
