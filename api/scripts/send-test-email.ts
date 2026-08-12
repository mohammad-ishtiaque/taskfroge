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

console.log(`
  Transport   ${env.EMAIL_TRANSPORT}
  Host        ${env.SMTP_HOST ?? '(not set)'}
  Port        ${env.SMTP_PORT ?? 587}
  User        ${env.SMTP_USER ?? '(not set)'}
  Password    ${redact(env.SMTP_PASS)}
  From        ${env.EMAIL_FROM}
  To          ${to}
`);

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
  const { smtpTransport } = await import('../src/lib/email/smtp.transport');

  const message = {
    to,
    subject: 'TaskForge test email',
    text:
      'If you are reading this, TaskForge can send email.\n\n' +
      `Sent by the test script at ${new Date().toISOString()}.\n` +
      `Transport: ${env.EMAIL_TRANSPORT}, host: ${env.SMTP_HOST ?? 'n/a'}.\n`,
  };

  if (env.EMAIL_TRANSPORT === 'console') {
    await sendEmail(message);
    return;
  }

  await smtpTransport.send(message);
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

  // The four refusals that account for nearly every failed first attempt.
  const hint =
    /EAUTH|535|534/.test(text)
      ? 'The username or password was rejected.\n' +
        '   · Gmail wants an app password, not your account password, and 2FA must be on.\n' +
        '   · Brevo wants the SMTP login shown on its SMTP page — it looks like\n' +
        '     xxxxx@smtp-brevo.com, not your Brevo account email — plus an SMTP key.'
      : /ENOTFOUND|EAI_AGAIN/.test(text)
        ? `The host "${env.SMTP_HOST ?? ''}" could not be resolved. Check the spelling.`
        : /ETIMEDOUT|ECONNREFUSED/.test(text)
          ? 'Nothing answered on that port. Port 587 with SMTP_SECURE=false, or 465\n' +
            '   with SMTP_SECURE=true — mixing them produces a hang rather than an error.'
          : /553|550|from|sender/i.test(text)
            ? `The server will not send as "${env.EMAIL_FROM}".\n` +
              '   The From address has to be one the provider has verified for you.'
            : null;

  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
});
