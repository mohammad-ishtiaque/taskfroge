import { describe, expect, it } from 'vitest';
import {
  hashToken,
  randomToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './tokens';
import { AppError } from './errors';

const CLAIMS = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'someone@example.test',
  role: 'PROJECT_MANAGER' as const,
  sid: 'session-1',
};

describe('access tokens', () => {
  it('round-trips its claims', () => {
    const decoded = verifyAccessToken(signAccessToken(CLAIMS));
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('PROJECT_MANAGER');
  });

  it('rejects a tampered payload', () => {
    const token = signAccessToken(CLAIMS);
    const [header, payload, signature] = token.split('.');

    // Re-encode the claims with an elevated role, keeping the old signature.
    const forged = Buffer.from(
      JSON.stringify({ ...CLAIMS, role: 'ADMIN' }),
    ).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${forged}.${signature}`)).toThrow(AppError);
    expect(payload).not.toBe(forged);
  });

  it('rejects a refresh token presented as an access token', () => {
    // Different secrets and audiences. If this ever passes, a stolen refresh
    // token becomes a working session.
    const refresh = signRefreshToken({ sub: 'u', orgId: 'o', sid: 's', gen: 1 });
    expect(() => verifyAccessToken(refresh)).toThrow(AppError);
  });

  it('rejects an access token presented as a refresh token', () => {
    expect(() => verifyRefreshToken(signAccessToken(CLAIMS))).toThrow(AppError);
  });

  it('reports garbage as TOKEN_INVALID rather than crashing', () => {
    try {
      verifyAccessToken('not-a-token');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).code).toBe('TOKEN_INVALID');
    }
  });
});

describe('opaque tokens', () => {
  it('produces a different value every time', () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomToken()));
    expect(seen.size).toBe(500);
  });

  it('is long enough to be unguessable', () => {
    // 32 bytes → 43 base64url characters.
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });

  it('hashes deterministically, so a stored hash can be looked up', () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not leak the token through its hash', () => {
    const token = randomToken();
    expect(hashToken(token)).not.toContain(token);
  });
});
