import type { Response } from 'express';

/**
 * One envelope for every response, success or failure:
 *
 *   { success: true,  data, meta }
 *   { success: false, error, meta }
 *
 * The client writes one parser instead of guessing per endpoint.
 */
export interface SuccessBody<T> {
  success: true;
  data: T;
  meta: { requestId: string; timestamp: string };
}

export interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  meta: { requestId: string; timestamp: string };
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  const body: SuccessBody<T> = {
    success: true,
    data,
    meta: { requestId: requestIdOf(res), timestamp: new Date().toISOString() },
  };
  res.status(status).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const body: ErrorBody = {
    success: false,
    error: { code, message, details },
    meta: { requestId: requestIdOf(res), timestamp: new Date().toISOString() },
  };
  res.status(status).json(body);
}

function requestIdOf(res: Response): string {
  return String(res.getHeader('x-request-id') ?? 'unknown');
}
