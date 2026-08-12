import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import type { EmailMessage, EmailTransport } from './index';

let cached: Transporter | null = null;

/** Built lazily, so a missing SMTP config never breaks `console` mode. */
function getTransporter(): Transporter {
  if (cached) return cached;

  const port = env.SMTP_PORT ?? 587;

  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 negotiates it with STARTTLS. Inferred unless
    // SMTP_SECURE says otherwise, because getting this wrong produces a
    // connection that hangs rather than one that fails.
    secure: env.SMTP_SECURE ?? port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,

    // Nodemailer's defaults are two minutes for the connection and ten for the
    // socket, which assume the far end will eventually say something. A host
    // that blocks outbound SMTP does not: the packets go nowhere and nothing
    // is ever refused. Without these three, that becomes a two-minute request.
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  });

  return cached;
}

export const smtpTransport: EmailTransport = {
  name: 'smtp',

  async send(message: EmailMessage): Promise<void> {
    await getTransporter().sendMail({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  },
};
