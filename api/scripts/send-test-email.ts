import { env } from '../src/config/env';
import { sendEmail } from '../src/lib/email';

/* ==========================================================================
   Does email actually work?
   --------------------------------------------------------------------------
   Configuring SMTP is a sequence of small things that each fail silently: a
   wrong host, a password with spaces in it, a From address the provider will
   not send as, a transport still set to `console`. The app's own failure mode
   makes this worse rather than better — `sendEmail` swallows errors on
   purpose, because a password reset should not 500 when a mail server blips.

   So the only honest way to know is to send one and read the answer. This
   prints what is configured, sends a real message, and translates the
   provider's refusal into the thing you have to change.

       npm run email:test -- you@example.com
   ========================================================================== */

/** In a function so the `never` from `process.exit` narrows for the caller. */
function recipient(): string {
  const value = process.argv[2];

  if (!value || !value.includes('@')) {
    console.error('\n  Usage:  npm run email:test -- you@example.com\n');
    process.exit(1);
  }

  return value;
}

const to = recipient();

/** Never print a secret, but do prove one is present and the right shape. */
function redact(value: string | undefined): string {
  if (!value) return '(not set)';
  return `${value.slice(0, 2)}…${value.slice(-2)}  (${value.length} chars)`;
}

console.log(
  env.EMAIL_TRANSPORT === 'brevo'
    ? `
  Transport   brevo (HTTPS, api.brevo.com)
  API key     ${redact(env.BREVO_API_KEY)}
  From        ${env.EMAIL_FROM}
  To          ${to}
`
    : `
  Transport   ${env.EMAIL_TRANSPORT}
  Host        ${env.SMTP_HOST ?? '(not set)'}
  Port        ${env.SMTP_PORT ?? 587}
  User        ${env.SMTP_USER ?? '(not set)'}
  Password    ${redact(env.SMTP_PASS)}
  From        ${env.EMAIL_FROM}
  To          ${to}
`,
);

/* This script passing proves the credentials are good. It does not prove the
   *server* can send, because it runs on your machine and your machine is not
   behind the host's egress rules. An SMTP config that passes here and fails on
   Render is exactly the shape of the bug this warning exists for. */
if (env.EMAIL_TRANSPORT === 'smtp') {
  console.log(
    '  Note: this runs locally. A host that blocks outbound SMTP — Render\n' +
      '  free services block 25, 465 and 587 — will fail with this same config.\n' +
      '  EMAIL_TRANSPORT=brevo goes over 443 and is not subject to that.\n',
  );
}

if (env.EMAIL_TRANSPORT === 'console') {
  console.log(
    '  EMAIL_TRANSPORT is "console" — the message below is printed, not sent.\n' +
      '  Set EMAIL_TRANSPORT=smtp to send it for real.\n',
  );
}

// Two shapes people get wrong, and both fail in confusing ways rather than
// obvious ones, so they are worth naming before the send rather than after.
if (env.SMTP_PASS?.includes(' ')) {
  console.warn(
    '  ⚠  SMTP_PASS contains spaces. Google shows an app password in groups of\n' +
      '     four for readability; SMTP wants the sixteen characters with no gaps.\n',
  );
}

if (env.EMAIL_FROM.includes('@') && !env.EMAIL_FROM.includes('<')) {
  console.warn(
    '  ⚠  EMAIL_FROM has an address but no angle brackets. Write it as\n' +
      '     "TaskForge <you@example.com>" or some servers reject the message.\n',
  );
}

/* `sendEmail` catches everything by design — a failed notification must never
   fail the request that triggered it. That is right in the app and useless
   here, so this calls the transport underneath it and lets the error out. */
async function main(): Promise<void> {
  const transport =
    env.EMAIL_TRANSPORT === 'brevo'
      ? (await import('../src/lib/email/brevo.transport')).brevoTransport
      : (await import('../src/lib/email/smtp.transport')).smtpTransport;

  const message = {
    to,
    subject: 'TaskForge test email',
    text:
      'If you are reading this, TaskForge can send email.\n\n' +
      `Sent by the test script at ${new Date().toISOString()}.\n` +
        `Transport: ${env.EMAIL_TRANSPORT}, host: ${
        env.EMAIL_TRANSPORT === 'brevo' ? 'api.brevo.com' : (env.SMTP_HOST ?? 'n/a')
      }.\n`,
  };

  if (env.EMAIL_TRANSPORT === 'console') {
    await sendEmail(message);
    return;
  }

  await transport.send(message);
  console.log('  ✓ Accepted by the mail server.\n');
  console.log(
    '  Accepted is not the same as delivered. Check the inbox, and check spam —\n' +
      '  a message that lands in spam is a domain-authentication problem, not a\n' +
      '  configuration one.\n',
  );
}

main().catch((error: unknown) => {
  const err = error as { code?: string; responseCode?: number; message?: string };
  const text = `${err.code ?? ''} ${err.responseCode ?? ''} ${err.message ?? ''}`;

  console.error(`\n  ✗ Failed.\n\n  ${err.message ?? String(error)}\n`);

  /* The refusals that account for nearly every failed first attempt, in order
     — the first match wins, so the specific ones come before the general. A
     table rather than a ladder of ternaries because it has outgrown one. */
  const hints: [RegExp, string][] = [
    [
      /unauthorized|Key not found/i,
      'Brevo did not recognise the API key.\n' +
        '   It is under SMTP & API → API keys and starts "xkeysib-". That is a\n' +
        '   different credential from the SMTP key on the same page.',
    ],
    [
      /unrecognised|unrecognized|sender.*not valid|not_enough_credits/i,
      `Brevo will not send as "${env.EMAIL_FROM}".\n` +
        '   Verify that address under Senders, Domains & Dedicated IPs first.',
    ],
    [
      /EAUTH|535|534/,
      'The username or password was rejected.\n' +
        '   · Gmail wants an app password, not your account password, and 2FA must be on.\n' +
        '   · Brevo SMTP wants the login from its SMTP page — it looks like\n' +
        '     xxxxx@smtp-brevo.com, not your Brevo account email — plus an SMTP key.',
    ],
    [
      /ENOTFOUND|EAI_AGAIN/,
      `The host "${env.SMTP_HOST ?? ''}" could not be resolved. Check the spelling.`,
    ],
    [
      /ETIMEDOUT|ECONNREFUSED|AbortError|timed out/i,
      'Nothing answered in time.\n' +
        '   · Port 587 with SMTP_SECURE=false, or 465 with SMTP_SECURE=true —\n' +
        '     mixing them produces a hang rather than an error.\n' +
        '   · Or the network blocks outbound SMTP. Render free services do.\n' +
        '     EMAIL_TRANSPORT=brevo uses port 443 instead.',
    ],
    [
      /553|550|from|sender/i,
      `The server will not send as "${env.EMAIL_FROM}".\n` +
        '   The From address has to be one the provider has verified for you.',
    ],
  ];

  const hint = hints.find(([pattern]) => pattern.test(text))?.[1] ?? null;

  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
});
