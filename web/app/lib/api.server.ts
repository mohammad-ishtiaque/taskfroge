import { getAccessToken } from './session.server';

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: { requestId: string; timestamp: string };
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  meta: { requestId: string; timestamp: string };
}

/**
 * A failed API call, normalised.
 *
 * `code` is what gets translated for the user; `message` is for the log. The
 * server's wording never reaches the screen — that is how five languages stay
 * consistent without translating the API too.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-keyed messages, ready to hand straight to a form. */
  get fieldIssues(): Record<string, string[]> | null {
    const issues = this.details?.issues;
    if (!issues || typeof issues !== 'object') return null;
    return issues as Record<string, string[]>;
  }
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Attaches the caller's bearer token. Omit for login and password reset. */
  request?: Request;
  timeoutMs?: number;
}

/**
 * Every server-side call to the API goes through here.
 *
 * All failures — HTTP errors, network faults, timeouts, non-JSON bodies —
 * come out as ApiError, so route code has exactly one thing to catch.
 */
export async function callApi<T>(path: string, options: CallOptions = {}): Promise<T> {
  const { method = 'GET', body, request, timeoutMs = 15_000 } = options;

  const headers = new Headers({ Accept: 'application/json' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  if (request) {
    const token = await getAccessToken(request);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    // Pass the trace id through, so one id spans web and API logs.
    const requestId = request.headers.get('x-request-id');
    if (requestId) headers.set('x-request-id', requestId);
  }

  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    // A timeout and a refused connection are the same to the user: we could
    // not reach the server. Distinguishing them helps nobody on screen.
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    throw new ApiError(
      'NETWORK',
      0,
      timedOut ? `Request to ${path} timed out` : `Cannot reach the API at ${API_URL}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<T>
    | ApiFailure
    | null;

  if (!payload) {
    // JSON-only API returning something else means a proxy answered, not us.
    throw new ApiError('INTERNAL_ERROR', response.status, 'API returned a non-JSON body');
  }

  if (!payload.success) {
    throw new ApiError(
      payload.error.code,
      response.status,
      payload.error.message,
      payload.error.details,
      payload.meta?.requestId,
    );
  }

  return payload.data;
}

/** Resolves any thrown value to a key the `errors` namespace can translate. */
export function toErrorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return 'UNKNOWN';
}
