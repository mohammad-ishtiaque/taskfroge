/**
 * Stable error codes.
 *
 * Part of the API contract: the web app maps each one to a translated message
 * (see `web/app/locales/*.json` → `errors.*`). Renaming one is a breaking
 * change. Add freely, never rename.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  /** The link is real, but this browser did not ask for it. Offer the code. */
  RESET_CHALLENGE_REQUIRED: 'RESET_CHALLENGE_REQUIRED',
  INVITATION_INVALID: 'INVITATION_INVALID',
  REGISTRATION_DISABLED: 'REGISTRATION_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * The only error type the application throws.
 *
 * Routes and services never throw bare Errors or call `res.status(400)`
 * directly — everything goes through here, so the error handler has exactly one
 * shape to serialise and the client has exactly one shape to parse.
 */
export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** Expected errors log at warn; unexpected ones log at error with a stack. */
  readonly expected: boolean;

  constructor(init: {
    code: ErrorCodeValue;
    status: number;
    message: string;
    details?: Record<string, unknown>;
    expected?: boolean;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = 'AppError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.expected = init.expected ?? init.status < 500;
    Error.captureStackTrace?.(this, AppError);
  }

  static is(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  static validation(message: string, details?: Record<string, unknown>) {
    return new AppError({ code: ErrorCode.VALIDATION_FAILED, status: 400, message, details });
  }

  static unauthenticated(
    message = 'Authentication required',
    code: ErrorCodeValue = ErrorCode.UNAUTHENTICATED,
  ) {
    return new AppError({ code, status: 401, message });
  }

  /**
   * Deliberately vague and always the same message, whether the email is
   * unknown or the password is wrong. Telling the difference hands an attacker
   * a list of registered addresses.
   */
  static invalidCredentials() {
    return new AppError({
      code: ErrorCode.INVALID_CREDENTIALS,
      status: 401,
      message: 'Email or password is incorrect',
    });
  }

  static forbidden(
    message = 'You do not have permission to do that',
    details?: Record<string, unknown>,
  ) {
    return new AppError({ code: ErrorCode.FORBIDDEN, status: 403, message, details });
  }

  static notFound(resource: string) {
    return new AppError({
      code: ErrorCode.NOT_FOUND,
      status: 404,
      message: `${resource} not found`,
    });
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return new AppError({ code: ErrorCode.ALREADY_EXISTS, status: 409, message, details });
  }

  static internal(message: string, cause?: unknown) {
    return new AppError({
      code: ErrorCode.INTERNAL_ERROR,
      status: 500,
      message,
      cause,
      expected: false,
    });
  }
}
