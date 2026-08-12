import { env } from '../../config/env';
import { logger } from '../logger';
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
 * One interface, swappable transports. Local development prints to the terminal
 * so nobody needs SMTP credentials to work on a password reset; production uses
 * SMTP (Resend speaks SMTP too, so it is the same transport).
 */
const transport: EmailTransport =
  env.EMAIL_TRANSPORT === 'smtp' ? smtpTransport : consoleTransport;

export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    await transport.send(message);
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
