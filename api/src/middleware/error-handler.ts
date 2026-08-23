import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError, ErrorCode } from '../lib/errors';
import { logger } from '../lib/logger';
import { sendError } from '../lib/response';
import mongoose from 'mongoose';

/**
 * The last stop for anything thrown anywhere.
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
    logger.warn(context, appError.message);
  } else {
    logger.error({ ...context, err: error }, appError.message);
  }

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

  if (error instanceof ZodError) {
    const issues = error.issues.reduce<Record<string, string[]>>((acc, issue) => {
      const path = issue.path.join('.') || '_root';
      (acc[path] ??= []).push(issue.message);
      return acc;
    }, {});

    return AppError.validation('Some fields need attention', { issues });
  }

  // Mongoose / Mongo 11000 duplicate key error
  const errAny = error as any;
  if (errAny?.code === 11000) {
    const keyValue = errAny.keyValue || {};
    const fields = Object.keys(keyValue);
    return AppError.conflict(
      `That ${fields.length ? fields.join(', ') : 'value'} is already in use`,
      { fields }
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return AppError.notFound(error.path || 'Record');
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const issues: Record<string, string[]> = {};
    for (const [field, err] of Object.entries(error.errors)) {
      issues[field] = [err.message];
    }
    return AppError.validation('Some fields need attention', { issues });
  }

  return AppError.internal(
    error instanceof Error ? error.message : 'Unhandled exception',
    error,
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, ErrorCode.NOT_FOUND, `Cannot ${req.method} ${req.originalUrl}`);
}
