import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { generalLimiter } from './middleware/rate-limit';
import { httpLogger, requestId } from './middleware/request-context';
import { authRouter } from './modules/auth/auth.routes';
import { invitationsRouter } from './modules/projects/invitations.routes';
import { projectsRouter } from './modules/projects/projects.routes';
import { healthRouter } from './modules/health/health.routes';
import { commentsRouter, projectTasksRouter, tasksRouter } from './modules/tasks/tasks.routes';
import { notificationsRouter, workspacesRouter } from './modules/workspaces/workspaces.routes';

/**
 * Assembles the app but does not listen, so tests can drive it with supertest
 * without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy in production; without this, req.ip is the proxy's
  // address and the rate limiter throttles everyone as one client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(httpLogger);

  app.use(
    helmet({
      // The API only ever returns JSON, so CSP has nothing to protect here.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );

  // 100kb is generous for JSON and small enough that a malicious body cannot
  // exhaust memory. Raise it when file uploads arrive in M5, not before.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(healthRouter);

  app.use('/api/v1', generalLimiter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/projects', projectsRouter);
  // Unauthenticated by design — the invitee may not have an account yet.
  app.use('/api/v1/invitations', invitationsRouter);
  app.use('/api/v1/projects', projectTasksRouter);
  app.use('/api/v1/tasks', tasksRouter);
  app.use('/api/v1/comments', commentsRouter);
  app.use('/api/v1/workspaces', workspacesRouter);
  app.use('/api/v1/notifications', notificationsRouter);


  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
