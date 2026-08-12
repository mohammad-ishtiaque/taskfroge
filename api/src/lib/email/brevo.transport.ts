import { env } from '../../config/env';
import type { EmailMessage, EmailTransport } from './index';

/* ==========================================================================
   Brevo over HTTPS, because SMTP is not always reachable.

   This transport exists for one concrete reason: Render blocks outbound
   traffic on ports 25, 465 and 587 for free web services. Not refuses —
   blocks. A connection to smtp.gmail.com:587 is accepted by the kernel and
   then never answered, so nodemailer waits, and whatever request triggered
   the email waits with it. That is how creating a project came to fail with
   "We couldn't reach the server" fifteen seconds after the project had
   already been written to the database.

   Brevo's REST API is the same mail service reached over port 443, which
   nothing blocks. Same account, same sender, same free allowance — a
   different door into the building.
   ========================================================================== */

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Nothing should wait on a mail provider longer than this. */
const TIMEOUT_MS = 10_000;

interface Address {
  name?: string;
  email: string;
}

/**
 * `TaskForge <no-reply@example.com>` → `{ name, email }`.
 *
 * SMTP takes the composed form and Brevo takes the parts, so one of the two
 * has to do this and `EMAIL_FROM` should not have to be written twice in two
 * shapes. A bare address with no display name is valid and stays valid.
 */
export function parseAddress(value: string): Address {
  const match = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(value);

  if (!match) return { email: value.trim() };

  const name = match[1]!.replace(/^"|"$/g, '').trim();
  return name ? { name, email: match[2]!.trim() } : { email: match[2]!.trim() };
}

/**
 * Brevo answers a refusal with a JSON body that is far more useful than its
 * status code — `{"code":"unauthorized","message":"Key not found"}` tells you
 * what to fix, where 401 alone does not. So the body goes into the error.
 */
async function describeFailure(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');

  try {
    const body = JSON.parse(raw) as { code?: string; message?: string };
    if (body.message) {
      return `Brevo refused the message: ${body.message}${body.code ? ` (${body.code})` : ''}`;
    }
  } catch {
    // Not JSON. Fall through to the raw text, truncated — an HTML error page
    // from a proxy in front of the API should not fill the log.
  }

  return `Brevo returned ${response.status} ${response.statusText}: ${raw.slice(0, 200)}`;
}

export const brevoTransport: EmailTransport = {
  name: 'brevo',

  async send(message: EmailMessage): Promise<void> {
    // Checked at boot too, so this is a type narrowing rather than a real
    // guard — but a transport that assumes its own configuration is a bad
    // habit to leave lying around.
    if (!env.BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY is not set');
    }

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseAddress(env.EMAIL_FROM),
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        // Brevo rejects an empty string here, so the key has to be absent
        // rather than blank when a message is text-only.
        ...(message.html ? { htmlContent: message.html } : {}),
        ...(env.EMAIL_REPLY_TO ? { replyTo: { email: env.EMAIL_REPLY_TO } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(await describeFailure(response));
    }
  },
};
