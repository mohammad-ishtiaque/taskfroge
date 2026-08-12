import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured logging. JSON in production so it can be shipped and queried;
 * human-readable locally.
 *
 * The redaction list is not optional. A password or a token in a log file is a
 * credential leak with a long tail — logs get copied into tickets, pasted into
 * chat, and kept for years.
 */
export const logger = pino({
  // Silent in tests. Request logs and the printed reset emails buried the one
  // failing assertion in hundreds of lines of noise, which makes a red build
  // harder to read than it needs to be.
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'refreshToken',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
  transport: env.LOG_PRETTY
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      }
    : undefined,
});
