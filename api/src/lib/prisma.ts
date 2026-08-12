import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env';
import { logger } from './logger';
import { isRetryable } from './retry-policy';

/* ==========================================================================
   A database that goes to sleep
   --------------------------------------------------------------------------
   Neon suspends its compute after a few minutes of inactivity. Every
   connection open at that moment is closed, and Prisma's pool does not find
   out until it hands one of them to a query. The first request after a quiet
   period then fails with one of:

       Error { kind: Closed, cause: None }                      (idle, hung up)
       terminating connection due to administrator command      (E57P01)

   Neither is a fault. Both were 500s.

   The pooled endpoint helps and does not finish the job — Neon's pooler
   suspends along with the compute it fronts. The part that was missing is
   that nothing retried, so one dead socket became one failed sign-in.
   ========================================================================== */

/** How many goes, and how long between them. Two retries, ~300ms worst case. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [50, 250];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function base(): PrismaClient {
  return new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
    errorFormat: isProduction ? 'minimal' : 'pretty',
  });
}

const client = base();

client.$on('warn' as never, (event: { message: string }) => {
  logger.warn({ prisma: event.message }, 'Prisma warning');
});

client.$on('error' as never, (event: { message: string }) => {
  logger.error({ prisma: event.message }, 'Prisma error');
});

/**
 * The retry, as a client extension.
 *
 * Here rather than in each service because the whole point is that no caller
 * has to remember. An interactive transaction's `tx` is deliberately not
 * wrapped: retrying one statement inside a transaction whose connection has
 * gone would rejoin a transaction that no longer exists.
 */
/* Prisma's own shape for a root-level `$allOperations` hook, spelled out
   rather than inferred. Two reasons: it documents that `operation` is a bare
   string here — the per-model form gets a union, this one does not — and it
   typechecks in a checkout where `prisma generate` has not run, which is
   where a missing engine binary otherwise turns into six implicit-any errors
   that look like a mistake in this file. */
interface Operation {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

const extended = client.$extends({
  query: {
    async $allOperations({ operation, args, query }: Operation) {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          return await query(args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (!isRetryable(message, operation) || attempt === MAX_ATTEMPTS) throw error;

          lastError = error;
          logger.warn(
            { operation, attempt, err: message.split('\n')[0] },
            'Database connection was closed; retrying',
          );

          await sleep(BACKOFF_MS[attempt - 1] ?? 250);
        }
      }

      throw lastError;
    },
  },
});

/**
 * One client for the process.
 *
 * Cached on `globalThis` in development because `tsx watch` re-imports modules
 * on every save, and a new client per reload exhausts the connection pool
 * within a minute of normal work.
 */
const globalForPrisma = globalThis as unknown as { prisma?: typeof extended };

export const prisma = globalForPrisma.prisma ?? extended;

if (!isProduction) globalForPrisma.prisma = prisma;

/**
 * Used by the readiness probe — and, incidentally, the cheapest way to wake a
 * suspended compute. It goes through the extension, so a probe arriving on a
 * dead connection reports the database as up rather than reporting the
 * suspend as an outage.
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Database ping failed');
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { env };
