import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError, ErrorCode } from '../lib/errors';
import { logger } from '../lib/logger';
import { sendError } from '../lib/response';

/**
 * The last stop for anything thrown anywhere.
 *
 * Three jobs, in priority order:
 *   1. Never leak internals — no stack traces or table names in production
 *   2. Always emit the same envelope, so the client has one parser
 *   3. Log at the right level, with enough context to debug without a repro
 */
/**
 * `express.json()` throws for a body over the limit, and for one that is not
 * valid JSON at all. Both are the client's mistake and both were answering
 * 500 — which reads as "the server broke" when the truth is "you sent 200KB".
 */
function bodyParserError(error: unknown): AppError | null {
  const e = error as { type?: string; status?: number; expose?: boolean } | null;
  if (!e?.type) return null;

  if (e.type === 'entity.too.large') {
    return new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      status: 413,
      message: 'That request is too large.',
    });
  }

  if (e.type === 'entity.parse.failed' || e.type === 'charset.unsupported') {
    return AppError.validation('The request body is not valid JSON');
  }

  return null;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = normalise(error);
  const requestId = String(res.getHeader('x-request-id') ?? 'unknown');

  const context = {
    requestId,
    code: appError.code,
    status: appError.status,
    method: req.method,
    path: req.originalUrl,
  };

  if (appError.expected) {
    // A handled condition. Useful signal, not an incident.
    logger.warn(context, appError.message);
  } else {
    logger.error({ ...context, err: error }, appError.message);
  }

  // 5xx messages are replaced in production — the real one may name a table.
  const message =
    isProduction && appError.status >= 500
      ? 'An unexpected error occurred. Our team has been notified.'
      : appError.message;

  sendError(res, appError.status, appError.code, message, appError.details);
}

function normalise(error: unknown): AppError {
  if (AppError.is(error)) return error;

  const fromBodyParser = bodyParserError(error);
  if (fromBodyParser) return fromBodyParser;

  // Zod failures become field-keyed messages a form can highlight directly.
  if (error instanceof ZodError) {
    const issues = error.issues.reduce<Record<string, string[]>>((acc, issue) => {
      const path = issue.path.join('.') || '_root';
      (acc[path] ??= []).push(issue.message);
      return acc;
    }, {});

    return AppError.validation('Some fields need attention', { issues });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint. Surfaced as a 409 with the field, not a 500.
    if (error.code === 'P2002') {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : [String(target ?? 'value')];
      return AppError.conflict(`That ${fields.join(', ')} is already in use`, { fields });
    }

    if (error.code === 'P2025') return AppError.notFound('Record');
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new AppError({
      code: ErrorCode.INTERNAL_ERROR,
      status: 503,
      message: 'The database is unavailable',
      cause: error,
      expected: true, // a known failure mode; do not page on one occurrence
    });
  }

  return AppError.internal(
    error instanceof Error ? error.message : 'Unhandled exception',
    error,
  );
}

/** Anything that reaches here matched no route. */
export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, ErrorCode.NOT_FOUND, `Cannot ${req.method} ${req.originalUrl}`);
}
