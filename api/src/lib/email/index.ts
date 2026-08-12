import { env } from '../../config/env';
import { logger } from '../logger';
import { brevoTransport } from './brevo.transport';
import { consoleTransport } from './console.transport';
import { smtpTransport } from './smtp.transport';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * One interface, swappable transports. Local development prints to the
 * terminal so nobody needs credentials to work on a password reset; production
 * uses `smtp` where the ports are open, or `brevo` where they are not — see
 * brevo.transport.ts for why that distinction had to exist.
 */
const transport: EmailTransport =
  env.EMAIL_TRANSPORT === 'smtp'
    ? smtpTransport
    : env.EMAIL_TRANSPORT === 'brevo'
      ? brevoTransport
      : consoleTransport;

/**
 * The backstop. Every transport sets its own timeout — nodemailer's socket
 * options, `AbortSignal.timeout` in the Brevo client — and this exists for the
 * case where one of them does not fire.
 *
 * Slightly longer than the transports' own limits on purpose: if this is what
 * trips, the log line says the transport's timeout failed to work, which is a
 * different bug from a slow mail server and should not look like one.
 */
const HARD_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`no answer after ${HARD_TIMEOUT_MS}ms`)),
        HARD_TIMEOUT_MS,
      // Do not hold the process open for a timer that exists only to give up.
      ).unref(),
    ),
  ]);
}

/**
 * Send, and wait for the result.
 *
 * Use this only where the caller genuinely needs to know — the test script,
 * and nothing else at present. Request handlers should use `queueEmail`.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    await withTimeout(transport.send(message));
    logger.info(
      { to: message.to, subject: message.subject, transport: transport.name },
      'Email sent',
    );
  } catch (error) {
    // A failed email must not fail the request that triggered it — a user who
    // asked for a reset link should not see a 500 because SMTP blipped. But it
    // must be loud in the logs, because silence here means people quietly stop
    // receiving mail.
    logger.error({ err: error, to: message.to, subject: message.subject }, 'EMAIL SEND FAILED');
  }
}

/**
 * Send, and do not wait.
 *
 * Awaiting a mail provider inside a write request means the provider's worst
 * case becomes the request's worst case. That is not theoretical: `POST
 * /projects` awaited its invitation emails, the host silently blocked the SMTP
 * port, and a project that had been created in 68ms took fifteen seconds to
 * answer and then did not — the client had already given up. The database was
 * correct and the screen said failure.
 *
 * So the rule is: the durable part of the work is awaited, the notification is
 * not. An invitation row is written and reported synchronously; the email
 * about it leaves afterwards. If it fails, the log says so and the invitation
 * is still there to resend or copy as a link.
 *
 * `sendEmail` already catches everything, so this cannot produce an unhandled
 * rejection — `void` here is the intent made visible rather than a silencer.
 */
export function queueEmail(message: EmailMessage): void {
  void sendEmail(message);
}
