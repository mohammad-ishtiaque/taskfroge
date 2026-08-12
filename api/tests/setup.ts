// Vitest does not load .env, and Prisma Client does not either. Without this
// the whole suite fails on a missing DATABASE_URL rather than on anything real.
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

/**
 * Test database lifecycle.
 *
 * `resetDatabase()` truncates every table. That is fine against a throwaway
 * database and catastrophic against a real one — and the difference is a single
 * environment variable, which is not a safe place for that decision to live.
 *
 * So the guard below is not a nicety. It refuses to run at all unless the
 * database name ends in `_test`, which makes wiping a development or production
 * database impossible rather than merely unlikely.
 */
function assertDisposableDatabase(): string {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Tests need their own database — run: npm run db:test:setup',
    );
  }

  const name = new URL(url).pathname.replace(/^\//, '').split('?')[0] ?? '';

  if (!name.endsWith('_test')) {
    throw new Error(
      `\n\n  REFUSING TO RUN.\n\n` +
        `  These tests truncate every table, and "${name}" is not a test database.\n` +
        `  Test databases must be named with a _test suffix.\n\n` +
        `  Set one up once:   npm run db:test:setup\n` +
        `  Then run tests:    npm test\n\n`,
    );
  }

  return name;
}

const databaseName = assertDisposableDatabase();

export const prisma = new PrismaClient();

/** Single source of truth for what gets wiped between tests. */
const TRUNCATED_TABLES = [
  'Notification', 'Activity', 'Comment', 'Task',
  'Invitation', 'ProjectVisibility', 'ProjectMember', 'Project', 'Workspace',
  'PushSubscription', 'EmailVerification', 'PasswordResetToken',
  'Session', 'Membership', 'User', 'Organization',
] as const;

export async function resetDatabase(): Promise<void> {
  // Re-checked on every call, not just at import. A test that reassigns
  // DATABASE_URL mid-run must not slip past the boot-time check.
  assertDisposableDatabase();

  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE ${TRUNCATED_TABLES.map((t) => `"${t}"`).join(', ')}
      RESTART IDENTITY CASCADE
    `);
  } catch (error) {
    // Prisma reports a missing database or a missing table as a raw driver
    // error, repeated once per test, which buries the one line that matters.
    // Both causes have the same one-command fix.
    const message = error instanceof Error ? error.message : String(error);
    const missingDatabase = message.includes('does not exist');
    const missingTable = message.includes('P2021') || message.includes('relation');

    if (missingDatabase || missingTable) {
      throw new Error(
        `\n\n  The test database is not ready.\n\n` +
          `  ${missingDatabase ? `"${databaseName}" does not exist yet.` : `"${databaseName}" exists but is missing tables — a migration has not been applied to it.`}\n\n` +
          `  Fix it with:   npm run db:test:setup\n\n` +
          `  (npm run test:integration does this for you; you have run vitest directly.)\n`,
      );
    }

    throw error;
  }
}

/**
 * Fails if a model exists that `resetDatabase` does not truncate.
 *
 * The list above is hand-maintained. A table missing from it does not error —
 * it leaves rows behind, and the symptom surfaces as an unrelated test failing
 * intermittently weeks later. Comparing against the schema turns that into an
 * immediate, obvious failure.
 */
export async function assertTruncateCoversEveryTable(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );

  const truncated = new Set<string>(TRUNCATED_TABLES);
  const missing = rows
    .map((r) => r.tablename)
    .filter((t) => !t.startsWith('_') && !truncated.has(t));

  if (missing.length > 0) {
    throw new Error(
      `\n\n  resetDatabase() does not truncate: ${missing.join(', ')}\n` +
        `  Add them to TRUNCATED_TABLES in tests/setup.ts.\n`,
    );
  }
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { databaseName };
