import type { NextFunction, Request, Response } from 'express';
import { AppError, ErrorCode } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';
import { Membership, Session, Role, UserDocument } from '../models';

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
      Membership.findOne({ orgId: claims.orgId, userId: claims.sub }).populate<{ userId: UserDocument }>('userId', 'isActive'),
      Session.findById(claims.sid).select('revokedAt userId'),
    ]);

    const user = membership?.userId as unknown as UserDocument | undefined;

    if (!membership || membership.status !== 'ACTIVE' || !user || !user.isActive) {
      throw AppError.unauthenticated(
        'Your access has been revoked',
        ErrorCode.ACCOUNT_INACTIVE,
      );
    }

    const sessionUserId = session?.userId ? session.userId.toString() : null;

    if (!session || session.revokedAt || sessionUserId !== claims.sub) {
      throw AppError.unauthenticated('This session has ended. Sign in again.');
    }

    req.auth = {
      userId: claims.sub,
      orgId: claims.orgId,
      email: claims.email,
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
