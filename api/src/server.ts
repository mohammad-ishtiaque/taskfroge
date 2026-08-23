import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { connectDatabase, disconnectDatabase, pingDatabase } from './lib/db';

async function main(): Promise<void> {
  try {
    await connectDatabase();
  } catch {
    logger.fatal('Cannot reach MongoDB database. Is it running?');
    process.exit(1);
  }

  if (!(await pingDatabase())) {
    logger.fatal('Cannot ping MongoDB database.');
    process.exit(1);
  }

  const server = createApp().listen(env.PORT, () => {
    logger.info(`TaskForge API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');

    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });

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
