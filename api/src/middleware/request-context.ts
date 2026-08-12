import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../lib/logger';

/**
 * Gives every request an id and echoes it back.
 *
 * When a user says "it broke", the id from their error screen is what finds the
 * exact log line. An inbound id is honoured so a trace survives the web → API
 * hop rather than starting again.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get('x-request-id');
  const id = inbound?.slice(0, 64) || randomUUID();

  res.setHeader('x-request-id', id);
  (req as Request & { id: string }).id = id;

  next();
}

const SILENT_PATHS = ['/health', '/health/ready', '/favicon.ico'];

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),

  // A health check every few seconds would bury everything else.
  autoLogging: { ignore: (req) => SILENT_PATHS.includes(req.url ?? '') },

  // 4xx is the caller's problem; 5xx is ours.
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  customSuccessMessage: (req, res, responseTime) =>
    `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,

  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
