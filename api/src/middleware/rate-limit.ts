import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';
import { ErrorCode } from '../lib/errors';

function build(options: { windowMs: number; max: number; message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    // Tests would otherwise trip the limiter and fail for the wrong reason.
    max: isTest ? 10_000 : options.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: ErrorCode.RATE_LIMITED, message: options.message },
        meta: {
          requestId: String(res.getHeader('x-request-id') ?? 'unknown'),
          timestamp: new Date().toISOString(),
        },
      });
    },
  });
}

/** Everything else. Generous — this is a backstop, not a business rule. */
export const generalLimiter = build({
  windowMs: 60_000,
  max: 300,
  message: 'Too many requests. Please wait a moment.',
});

/** Login. Tight, because this is the endpoint an attacker brute-forces. */
export const loginLimiter = build({
  windowMs: 15 * 60_000,
  max: 10,
  message: 'Too many sign-in attempts. Please try again in a few minutes.',
});

/**
 * Password reset requests. Tight for a second reason as well as brute force:
 * an open reset endpoint is a way to send unlimited email to any address.
 */
export const passwordResetLimiter = build({
  windowMs: 60 * 60_000,
  max: 5,
  message: 'Too many reset requests. Please try again later.',
});
