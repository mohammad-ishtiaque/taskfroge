import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import type { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and replaces the request part with the parsed result.
 *
 * The replacement matters: Zod strips unknown keys, so a caller cannot smuggle
 * `{ role: 'PROJECT_MANAGER' }` into a profile update and hope some spread
 * picks it up. That property is worth more than the type inference.
 *
 * ZodErrors are caught by the error handler, which turns them into field-keyed
 * messages the form can highlight.
 */
export function validate<T>(schema: ZodSchema<T>, source: Source = 'body') {
  return function validator(req: Request, _res: Response, next: NextFunction): void {
    // `express.json()` happily parses `"a string"`, `[1,2]` and `42` — all
    // valid JSON, none of them a body any endpoint can use. Zod then walks a
    // non-object looking for keys, and the failure surfaces as a 500, which
    // tells an attacker they have found an unhandled path.
    if (source === 'body') {
      const body: unknown = req.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        next(AppError.validation('Expected a JSON object'));
        return;
      }
    }

    try {
      const parsed = schema.parse(req[source]);
      Object.defineProperty(req, source, { value: parsed, writable: true, configurable: true });
      next();
    } catch (error) {
      next(error);
    }
  };
}
