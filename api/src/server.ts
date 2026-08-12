import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { disconnectDatabase, pingDatabase } from './lib/prisma';

async function main(): Promise<void> {
  // Fail at boot rather than on the first request. A container that dies
  // immediately is easier to diagnose than one that starts and 500s.
  if (!(await pingDatabase())) {
    logger.fatal('Cannot reach the database. Is it running? Try: docker compose up -d');
    process.exit(1);
  }

  const server = createApp().listen(env.PORT, () => {
    logger.info(`TaskForge API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Draining on SIGTERM is what makes a rolling deploy invisible: in-flight
  // requests finish instead of being cut off mid-response.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');

    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });

    // If something is holding a connection open, do not hang forever.
    setTimeout(() => {
      logger.warn('Forced exit after 10s drain timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection — exiting');
    process.exit(1);
  });
}

void main().catch((error: unknown) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
