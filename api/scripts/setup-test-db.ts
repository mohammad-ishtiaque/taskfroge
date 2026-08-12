/**
 * Creates the test database and brings its schema up to date.
 *
 * Tests truncate every table, so they need a database of their own. Sharing one
 * with development means running the suite deletes your work — which is exactly
 * what happened before this script existed.
 *
 *   npm run db:test:setup      (run once, and again after a new migration)
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { Client } from 'pg';

async function main(): Promise<void> {
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

  const url = new URL(devUrl);
  const devName = url.pathname.replace(/^\//, '').split('?')[0]!;

  if (devName.endsWith('_test')) {
    throw new Error(
      `DATABASE_URL already points at a test database ("${devName}").\n` +
        'Point it at your development database — this script derives the test one from it.',
    );
  }

  const testName = `${devName}_test`;

  // Connect to the maintenance database; you cannot CREATE DATABASE from
  // inside the database you are creating.
  const admin = new URL(devUrl);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();

  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);

  if (exists.rowCount === 0) {
    // Identifier cannot be parameterised; testName is derived from our own
    // config and validated above, not from user input.
    await client.query(`CREATE DATABASE "${testName}"`);
    console.log(`  created database ${testName}`);
  } else {
    console.log(`  database ${testName} already exists`);
  }

  await client.end();

  const testUrl = new URL(devUrl);
  testUrl.pathname = `/${testName}`;

  console.log('  applying migrations…');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    // DIRECT_URL as well as DATABASE_URL, and this is not decoration.
    // schema.prisma routes migrations through `directUrl`, so overriding only
    // DATABASE_URL would apply these migrations to the *development* database
    // while the tests ran against an empty test one. Silent, and destructive
    // in the direction that matters.
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      DIRECT_URL: testUrl.toString(),
    },
  });

  console.log(`\n  Ready. Tests will use ${testName}; your data in ${devName} is untouched.\n`);
}

/**
 * Turns driver-level errors into the one action that fixes them.
 *
 * A stack trace ending in `TCPConnectWrap.afterConnect` is accurate and tells
 * you nothing. There are only a handful of ways this script fails, each has a
 * single fix, and naming it is the difference between a five-second problem and
 * a twenty-minute one.
 */
function explain(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  const url = process.env.DATABASE_URL;
  const where = url ? `${new URL(url).hostname}:${new URL(url).port || '5432'}` : 'the database';

  if (code === 'ECONNREFUSED') {
    return (
      `Nothing is listening on ${where}, so PostgreSQL is not running.\n\n` +
      `  Start it:      docker compose up -d   (from this api/ directory)\n` +
      `  Check it:      docker compose ps       (the db container should say "healthy")\n` +
      `  Then retry:    npm run test:integration`
    );
  }

  if (code === 'ENOTFOUND') {
    return (
      `The host in DATABASE_URL (${where}) could not be resolved.\n\n` +
      `  On Windows, use 127.0.0.1 rather than localhost — see .env.example.`
    );
  }

  if (code === '28P01' || message.includes('password authentication failed')) {
    return (
      `PostgreSQL refused the credentials in DATABASE_URL.\n\n` +
      `  Most often this is a second PostgreSQL on the same port, not a wrong password.\n` +
      `  Check:         npm run db:check`
    );
  }

  return null;
}

void main().catch((error: unknown) => {
  const advice = explain(error);

  if (advice) {
    console.error(`\n  Could not set up the test database.\n\n  ${advice}\n`);
  } else {
    console.error('\nCould not set up the test database:', error);
  }

  process.exit(1);
});
