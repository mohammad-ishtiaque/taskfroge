import { logger } from '../logger';
import type { EmailMessage, EmailTransport } from './index';

/**
 * Prints the email instead of sending it.
 *
 * The full body is printed, link and all, because the point in local
 * development is to click the password-reset link without configuring SMTP.
 */
export const consoleTransport: EmailTransport = {
  name: 'console',

  send(message: EmailMessage): Promise<void> {
    const divider = '─'.repeat(72);

    logger.info(
      `\n${divider}\n` +
        `📧  To:      ${message.to}\n` +
        `    Subject: ${message.subject}\n` +
        `${divider}\n` +
        `${message.text}\n` +
        `${divider}\n`,
    );

    return Promise.resolve();
  },
};
