import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(hash, 'correct-horse-batteryX')).toBe(false);
  });

  it('salts, so the same password never produces the same hash twice', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('uses argon2id at the intended cost', async () => {
    // Encoded in the hash string. If someone lowers these to speed up tests,
    // this fails rather than silently weakening every stored password.
    const hash = await hashPassword('anything');
    expect(hash).toContain('$argon2id$');
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
  });

  it('returns false on a malformed hash rather than throwing', async () => {
    // A corrupt row must be a failed login, not a 500.
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });

  it('has a usable dummy hash for the unknown-email path', async () => {
    // login() verifies against this when the user does not exist, so that a
    // failed sign-in takes the same time either way. If it is malformed the
    // comparison returns early and the timing defence quietly stops working.
    expect(DUMMY_HASH).toContain('$argon2id$');
    expect(await verifyPassword(DUMMY_HASH, 'anything')).toBe(false);
  });
});
