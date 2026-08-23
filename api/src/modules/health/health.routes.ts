import { Router } from 'express';
import { env } from '../../config/env';
import { pingDatabase } from '../../lib/db';

export const healthRouter = Router();

const startedAt = Date.now();

/**
 * Liveness and readiness are separate on purpose.
 *
 * Liveness answers "is this process wedged?" — restart the container if it
 * fails. Readiness answers "can it serve traffic?" — take it out of the load
 * balancer, but do not restart it, because restarting will not fix a database
 * that is down.
 */
/**
 * Root route.
 *
 * Anyone who opens the API in a browser expects to see *something*. Without
 * this they get a bare 404 envelope and reasonably conclude the server is
 * broken, when in fact it is fine and the UI is on another port.
 */
healthRouter.get('/', (_req, res) => {
  res.json({
    service: 'taskforge-api',
    status: 'ok',
    message: 'This is the API. The application runs on the web app, not here.',
    webApp: env.WEB_ORIGIN,
    endpoints: {
      health: '/health',
      readiness: '/health/ready',
      api: '/api/v1',
    },
  });
});

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  });
});

healthRouter.get('/health/ready', (_req, res) => {
  void (async () => {
    const database = await pingDatabase();

    res.status(database ? 200 : 503).json({
      status: database ? 'ok' : 'degraded',
      checks: { database: database ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    });
  })();
});
