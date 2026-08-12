import argon2 from 'argon2';

/**
 * argon2id at the OWASP baseline: 64 MiB memory, 3 passes, 4 lanes.
 *
 * Deliberately expensive. The cost is paid once per login and is what makes an
 * offline attack on a leaked hash impractical.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed stored hash is a verification failure, not a crash.
    return false;
  }
}

/**
 * A real argon2id hash of a random string, verified against when the email is
 * unknown so a failed login takes the same time either way. Without this, an
 * attacker learns which addresses are registered from response timing alone.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$MTIzNDU2Nzg5MGFiY2RlZg$w1kQ8kNTPvmYK1kSN7Ov6cM8jNPHPr0Z2QY6ZUJnW5A';
