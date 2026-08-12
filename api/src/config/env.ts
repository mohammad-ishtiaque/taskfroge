// Side-effect import, and it must stay the first one in the file.
//
// Nothing else loads .env for the application: Prisma reads it independently,
// which is why migrations worked while the server refused to start. Imports are
// hoisted in CommonJS, so this has to be an import rather than a config() call
// placed between them.
//
// In production the platform injects real environment variables and no .env
// exists; dotenv then does nothing, and never overrides what is already set.
import 'dotenv/config';

import { z } from 'zod';

/**
 * Environment contract, validated once at boot.
 *
 * If something here is wrong the process refuses to start. A container that
 * dies immediately with a readable message is far easier to diagnose than one
 * that starts and fails on the first request that happens to touch a bad value.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),

    /**
     * Where the web app lives. Does two jobs: the CORS allow-list, and the
     * base of every link we put in an email.
     *
     * Absolute and without a trailing slash — an invitation link is useless
     * relative, because the person clicking it is in their mail client rather
     * than on the site.
     *
     * There was briefly a second variable, `APP_URL`, that meant exactly this
     * and was read by nothing. Two names for one value is worse than an
     * awkward name: a deployment sets the one it finds in `.env.example`,
     * leaves the other at its default, and every invitation email quietly
     * points at localhost. The guard below refuses to start if `APP_URL` is
     * still set, because deleting it silently would spring the same trap in
     * the opposite direction.
     */
    WEB_ORIGIN: z
      .string()
      .url()
      .default('http://localhost:5173')
      .transform((v) => v.replace(/\/$/, '')),

    // Open for first-run setup, closed once your workspace exists. Everyone
    // else joins by invitation (M1), not by signing up.
    ALLOW_REGISTRATION: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    DATABASE_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /**
     * Web push, VAPID.
     *
     * Optional as a pair. Push is a feature rather than a dependency: with the
     * keys absent the app still writes every notification and still shows the
     * badge, it simply does not ring a phone. Failing to boot over a missing
     * notification key would be the wrong trade.
     *
     * Generate once with `npx web-push generate-vapid-keys` and keep them —
     * rotating the public key invalidates every existing subscription, and
     * every user has to grant permission again.
     */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    /** Where a push service should complain. `mailto:` is what the spec wants. */
    VAPID_SUBJECT: z.string().default('mailto:admin@taskforge.local'),

    EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().default('TaskForge <no-reply@taskforge.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    /**
     * Implicit TLS. Port 465 is always secure; 587 uses STARTTLS and must be
     * false. Left undefined it is inferred from the port, which is right for
     * every provider I know of — set it only if yours is unusual.
     */
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    /** Shown as the reply address. Falls back to EMAIL_FROM. */
    EMAIL_REPLY_TO: z.string().email().optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((env, ctx) => {
    // One key without the other is a configuration mistake rather than a
    // choice, and it fails at send time rather than at boot — which is to say,
    // silently, weeks later, when somebody wonders why pushes stopped.
    if (Boolean(env.VAPID_PUBLIC_KEY) !== Boolean(env.VAPID_PRIVATE_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VAPID_PRIVATE_KEY'],
        message: 'set both VAPID keys or neither — one alone cannot sign a push',
      });
    }

    // `APP_URL` used to be a second name for `WEB_ORIGIN`. Refusing to start
    // is deliberate: a deployment that sets only `APP_URL` would otherwise
    // boot happily and send every invitation with a localhost link, and the
    // first sign of trouble would be a client saying the link is broken.
    if (process.env.APP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message:
          'no longer exists — it meant the same thing as WEB_ORIGIN and was read ' +
          'by nothing. Move the value to WEB_ORIGIN and delete this line',
      });
    }

    // Using one secret for both token types means an access token can be
    // replayed as a refresh token. Cheap to check, expensive to discover later.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'the development default cannot be used in production',
        });
      }
      if (env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT === 'console') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_TRANSPORT'],
          message:
            'must be "smtp" in production — "console" prints invitations and ' +
            'password resets to the server log and sends nothing, which looks ' +
            'like working software until a user waits for an email that never ' +
            'arrives',
        });
      }

      if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_HOST'],
          message: 'required when EMAIL_TRANSPORT is smtp',
        });
      }
      if (env.LOG_PRETTY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_PRETTY'],
          message: 'must be false in production — it breaks structured log shipping',
        });
      }

      // The actual failure this whole section exists to prevent. A production
      // API left on the default sends invitations whose link only works on the
      // machine that sent them.
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(env.WEB_ORIGIN)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEB_ORIGIN'],
          message:
            'still points at localhost — every invitation and password-reset ' +
            'link would be unopenable for the person receiving it. Set it to ' +
            'the public address of the web app',
        });
      }
    }
  });

/* ── Variables nothing reads ────────────────────────────────────────────────
   Zod strips unknown keys, which is the right default and a terrible silence.
   Set `MAIL_TRANSPORT=smtp` instead of `EMAIL_TRANSPORT=smtp` and the app
   starts, reports no problem, and sends nothing — for as long as it takes
   somebody to notice an invitation never arrived.

   So: anything that *looks* like it was meant for us and is not, gets named at
   startup. Only the prefixes we own, so a machine full of unrelated
   environment variables does not produce a wall of noise. A warning rather
   than a refusal — a typo in an optional setting should not stop a server —
   but a loud one, listing the nearest real name.               */

const KNOWN = new Set(Object.keys(schema._def.schema.shape));
const OURS = /^(SMTP|EMAIL|MAIL|VAPID|JWT|WEB|ALLOW|ACCESS_TOKEN|REFRESH_TOKEN|LOG)_/;

function warnAboutStrays(): void {
  const strays = Object.keys(process.env).filter((key) => OURS.test(key) && !KNOWN.has(key));
  if (strays.length === 0) return;

  for (const stray of strays) {
    // The closest real name by shared prefix length — enough to catch
    // SMTP_PASSWORD → SMTP_PASS and MAIL_TRANSPORT → EMAIL_TRANSPORT.
    const closest = [...KNOWN]
      .map((known) => {
        let shared = 0;
        while (shared < known.length && shared < stray.length && known[shared] === stray[shared]) {
          shared += 1;
        }
        return { known, shared };
      })
      .sort((a, b) => b.shared - a.shared)[0];

    const hint = closest && closest.shared >= 4 ? `  Did you mean ${closest.known}?` : '';
    // eslint-disable-next-line no-console
    console.warn(`  ⚠  ${stray} is set but nothing reads it.${hint}`);
  }
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  // Not the logger — the logger needs config, and config is what just failed.
  console.error(`\nInvalid environment configuration:\n${details}\n`);
  process.exit(1);
}

// After validation, so a genuinely broken config fails first and the warning
// does not compete with the error for attention.
warnAboutStrays();

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
