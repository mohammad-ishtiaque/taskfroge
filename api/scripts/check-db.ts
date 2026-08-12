/**
 * Answers "why can't I connect to the database?" in plain language.
 *
 * Prisma's P1000 says "authentication failed" for at least four different
 * causes, and the difference between them is the whole of the fix. This script
 * checks each one and names it.
 *
 *   npm run db:check
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, parse } from 'dotenv';
import { Client } from 'pg';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

function fail(message: string, ...fixes: string[]): never {
  console.error(`\n${RED}✗${RESET} ${message}\n`);
  fixes.forEach((fix) => console.error(`  ${fix}`));
  console.error('');
  process.exit(1);
}

async function main(): Promise<void> {
  console.log('\nChecking the database connection…\n');

  // 1. Is DATABASE_URL being shadowed by a real environment variable?
  //
  // dotenv does not override variables that already exist, so an OS-level
  // DATABASE_URL silently wins over .env while Prisma still prints
  // "Environment variables loaded from .env". It is the single most confusing
  // failure in this whole setup.
  //
  // The file has to be read and parsed directly. Comparing process.env before
  // and after `config()` cannot work — not overriding is precisely the
  // behaviour being detected.
  const shadowed = process.env.DATABASE_URL;

  const envPath = resolve(process.cwd(), '.env');
  const fromFile = existsSync(envPath)
    ? parse(readFileSync(envPath)).DATABASE_URL
    : undefined;

  config();

  if (shadowed && fromFile && shadowed !== fromFile) {
    fail(
      'DATABASE_URL is set in your environment and is overriding .env',
      `${DIM}Your environment says:${RESET} ${shadowed}`,
      `${DIM}Your .env says:       ${RESET} ${fromFile ?? '(nothing)'}`,
      '',
      'Clear it for this session:   Remove-Item Env:DATABASE_URL',
      'Or permanently:              setx DATABASE_URL ""   (then reopen the terminal)',
    );
  }

  const url = fromFile ?? process.env.DATABASE_URL;
  if (!url) {
    fail('DATABASE_URL is not set', 'Copy the example file:  cp .env.example .env');
  }

  const parsed = new URL(url);
  console.log(`  host      ${parsed.hostname}:${parsed.port || 5432}`);
  console.log(`  database  ${parsed.pathname.slice(1)}`);
  console.log(`  user      ${parsed.username}\n`);

  // 2. Can we reach the port at all, and are the credentials right?
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });

  try {
    await client.connect();
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = (error as Error).message;

    if (code === 'ECONNREFUSED') {
      fail(
        `Nothing is listening on ${parsed.hostname}:${parsed.port}`,
        'Start the database:  docker compose up -d',
        'Then check it:       docker compose ps',
      );
    }

    if (code === '28P01' || /password authentication failed/i.test(message)) {
      fail(
        `The password for "${parsed.username}" was rejected`,
        'Most likely another PostgreSQL is on this port. Check:',
        '  netstat -ano | findstr ":5432"',
        '',
        'If a second one is listening, move the container to 5433:',
        '  1. docker-compose.yml  →  ports: [\'5433:5432\']',
        '  2. .env DATABASE_URL   →  @127.0.0.1:5433/',
        '  3. docker compose down && docker compose up -d',
      );
    }

    if (code === '3D000') {
      fail(
        `The database "${parsed.pathname.slice(1)}" does not exist`,
        'Recreate the container and its volume:  docker compose down -v && docker compose up -d',
      );
    }

    if (code === '28000') {
      fail(
        `The role "${parsed.username}" does not exist on this server`,
        'The volume was created before these credentials were set.',
        'Destroy it and start clean:  docker compose down -v && docker compose up -d',
        `${DIM}(-v is the important part — without it the old data survives)${RESET}`,
      );
    }

    fail(`Could not connect: ${message}`);
  }

  // 3. Confirm we are where we think we are.
  const result = await client.query<{ user: string; db: string; version: string }>(
    'select current_user as user, current_database() as db, version() as version',
  );
  const row = result.rows[0]!;
  await client.end();

  console.log(`${GREEN}✓${RESET} Connected as ${row.user} to ${row.db}`);
  console.log(`${DIM}  ${row.version.split(',')[0]}${RESET}\n`);

  if (!row.version.includes('16.')) {
    console.log(
      `${YELLOW}!${RESET} Expected PostgreSQL 16 (the version in docker-compose.yml).\n` +
        `  You may be connected to a different server than you think.\n`,
    );
  }

  console.log('Ready. Next:  npx prisma migrate dev --name m0_auth\n');
}

void main().catch((error: unknown) => {
  console.error('\nUnexpected failure:', error);
  process.exit(1);
});
