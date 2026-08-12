import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config();

/**
 * Tests run against `<yourdb>_test`, never against your development database.
 *
 * Derived rather than configured separately: a second env var is a second thing
 * to forget, and forgetting this one truncates real data. `tests/setup.ts`
 * additionally refuses to run against any database whose name lacks the `_test`
 * suffix, so this is belt and braces.
 */
function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return '';

  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '').split('?')[0] ?? '';

  if (!name.endsWith('_test')) parsed.pathname = `/${name}_test`;
  return parsed.toString();
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // DIRECT_URL alongside DATABASE_URL: schema.prisma requires it, and it
    // must point at the *test* database too. Left at its .env value it would
    // aim the migration runner at development data.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      DIRECT_URL: testDatabaseUrl(),
    },
    // Integration tests share one database and truncate between files. In
    // parallel, one file would wipe another's fixtures mid-assertion.
    fileParallelism: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 20_000,
    // The default reporter redraws the whole tree continuously, which is
    // unreadable once the suite takes more than a second.
    reporters: ['basic'],
  },
});
