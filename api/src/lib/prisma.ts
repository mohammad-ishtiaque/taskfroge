import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env';
import { logger } from './logger';

/**
 * One Prisma client for the process.
 *
 * Cached on `globalThis` in development because `tsx watch` re-imports modules
 * on every save, and a new client per reload exhausts the connection pool
 * within a minute of normal work.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
    errorFormat: isProduction ? 'minimal' : 'pretty',
  });

if (!isProduction) globalForPrisma.prisma = prisma;

prisma.$on('warn' as never, (event: { message: string }) => {
  logger.warn({ prisma: event.message }, 'Prisma warning');
});

prisma.$on('error' as never, (event: { message: string }) => {
  logger.error({ prisma: event.message }, 'Prisma error');
});

/** Used by the readiness probe. */
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
