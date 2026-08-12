import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Role gate.
 *
 * This is the coarse check — "can a Developer ever do this?". Row-level
 * questions like "is this task theirs?" belong in the service that loads the
 * row, because only it has the row. Two layers, cheapest first.
 *
 *   router.post('/projects', authenticate, authorize('PROJECT_MANAGER'), handler)
 */
export function authorize(...allowed: Role[]) {
  return function roleGuard(req: Request, _res: Response, next: NextFunction): void {
    const auth = req.auth;

    if (!auth) {
      next(AppError.internal('authorize() ran before authenticate()'));
      return;
    }

    if (!allowed.includes(auth.role)) {
      // Worth logging: a spike here is either a misconfigured role or someone
      // probing, and both are things you want to see.
      logger.warn(
        {
          userId: auth.userId,
          role: auth.role,
          allowed,
          method: req.method,
          path: req.originalUrl,
        },
        'Permission denied',
      );

      next(AppError.forbidden(`This action requires: ${allowed.join(' or ')}`));
      return;
    }

    next();
  };
}
