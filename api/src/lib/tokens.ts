import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { AppError, ErrorCode } from './errors';

export interface AccessTokenClaims {
  sub: string;
  orgId: string;
  email: string;
  role: Role;
  /** Session id — lets one device be revoked without a password reset. */
  sid: string;
}

export interface RefreshTokenClaims {
  sub: string;
  orgId: string;
  sid: string;
  /** Rotation counter. An older generation presented means the token was stolen. */
  gen: number;
}

const ISSUER = 'taskforge';

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
    issuer: ISSUER,
    audience: 'taskforge-api',
  });
}

export function signRefreshToken(claims: RefreshTokenClaims): string {
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    issuer: ISSUER,
    audience: 'taskforge-refresh',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: 'taskforge-api',
    }) as AccessTokenClaims;
  } catch (error) {
    throw toAuthError(error);
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: ISSUER,
      audience: 'taskforge-refresh',
    }) as RefreshTokenClaims;
  } catch (error) {
    throw toAuthError(error);
  }
}

/**
 * "Expired" and "invalid" are different to the client: expired triggers a
 * silent refresh, invalid forces a re-login. Collapsing them means every
 * expiry logs the user out.
 */
function toAuthError(error: unknown): AppError {
  const name = (error as Error)?.name;

  if (name === 'TokenExpiredError') {
    return AppError.unauthenticated('Token has expired', ErrorCode.TOKEN_EXPIRED);
  }
  return AppError.unauthenticated('Token is invalid', ErrorCode.TOKEN_INVALID);
}

/** Opaque, high-entropy value for refresh tokens and reset links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Refresh and reset tokens are stored hashed, like passwords. If the table
 * leaks, what leaks is not usable.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
