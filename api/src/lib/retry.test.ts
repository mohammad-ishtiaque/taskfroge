import { describe, expect, it } from 'vitest';
import { isRetryable } from './retry-policy';

/* ==========================================================================
   Which database errors may be tried again
   --------------------------------------------------------------------------
   Neon suspends its compute when idle and closes every open connection. The
   first query afterwards fails on a socket that is already dead, and until
   there was a retry that meant a 500 on somebody's sign-in.

   Retrying is easy. Retrying *safely* is the part worth a test, because the
   cost of being wrong is asymmetric: a read replayed once is free, and a
   write replayed once could take payment twice. So the policy is small and
   deliberately conservative, and it lives in its own file so it can be
   tested without a database.
   ========================================================================== */

const CLOSED = 'Error in PostgreSQL connection: Error { kind: Closed, cause: None }';
const ADMIN = 'terminating connection due to administrator command';

describe('a connection that never carried the statement', () => {
  // Nothing ran, so repeating it cannot repeat an effect. Safe for writes.
  it.each([
    ['Prisma finding a dead socket in its own pool', CLOSED],
    ['cannot reach the server', "P1001: Can't reach database server at ep-x.neon.tech"],
    ['the server closed the connection', 'P1017: Server has closed the connection.'],
  ])('retries a write when %s', (_why, message) => {
    expect(isRetryable(message, 'create')).toBe(true);
    expect(isRetryable(message, 'findMany')).toBe(true);
  });
});

describe('a server that hung up, possibly mid-statement', () => {
  it('retries a read', () => {
    expect(isRetryable(ADMIN, 'findFirst')).toBe(true);
    expect(isRetryable('E57P01', 'count')).toBe(true);
  });

  it('does not retry a write', () => {
    // The connection died at an unknown point. An INSERT that committed and
    // then lost its connection looks identical from here to one that never
    // ran, and replaying the first writes the row twice. A failed request is
    // recoverable; a duplicate is not.
    expect(isRetryable(ADMIN, 'create')).toBe(false);
    expect(isRetryable(ADMIN, 'update')).toBe(false);
    expect(isRetryable(ADMIN, 'deleteMany')).toBe(false);
    expect(isRetryable(ADMIN, 'upsert')).toBe(false);
  });
});

describe('everything else', () => {
  it('is not retried at all', () => {
    // A unique-constraint violation is not going to succeed on the second
    // attempt, and retrying it turns one clear error into three and a
    // 350ms delay before the user sees it.
    expect(isRetryable('Unique constraint failed on the fields: (`email`)', 'create')).toBe(false);
    expect(isRetryable('P2002', 'create')).toBe(false);
    expect(isRetryable('Timed out fetching a new connection from the pool', 'findMany')).toBe(
      false,
    );
  });
});
