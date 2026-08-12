import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { brevoTransport, parseAddress } from './brevo.transport';

/* ==========================================================================
   These tests exist because of one afternoon.

   `POST /projects` awaited its invitation emails. Render blocks outbound SMTP
   on free services by dropping the packets rather than refusing them, so
   nodemailer sat there. A project written to the database in 68ms answered
   after fifteen seconds, by which point the browser had given up, and the
   screen said "We couldn't reach the server" about a project that existed.

   Two lessons, and a test for each:

     1. Mail providers do not belong on the critical path of a write.
     2. SMTP is not universally reachable, so there has to be a way out over
        HTTPS — and that way out has to build a request the provider accepts.
   ========================================================================== */

describe('parseAddress', () => {
  // SMTP takes `Name <addr>` composed; Brevo takes the parts separately.
  // EMAIL_FROM is written once, in the composed form, so this does the
  // splitting — and it is the kind of small parser that is wrong in exactly
  // one case nobody tried.
  it('splits a display name from the address', () => {
    expect(parseAddress('TaskForge <no-reply@example.com>')).toEqual({
      name: 'TaskForge',
      email: 'no-reply@example.com',
    });
  });

  it('accepts a bare address', () => {
    expect(parseAddress('no-reply@example.com')).toEqual({ email: 'no-reply@example.com' });
  });

  it('strips quotes around a name that needs them', () => {
    expect(parseAddress('"Acme, Inc." <hi@acme.test>')).toEqual({
      name: 'Acme, Inc.',
      email: 'hi@acme.test',
    });
  });

  it('omits an empty name rather than sending one', () => {
    // Brevo rejects `{"name":""}`. An address written `<hi@acme.test>` is
    // legal and would otherwise produce exactly that.
    expect(parseAddress('<hi@acme.test>')).toEqual({ email: 'hi@acme.test' });
  });

  it('tolerates the stray whitespace people leave in environment variables', () => {
    expect(parseAddress('  TaskForge   <  hi@acme.test  >  ')).toEqual({
      name: 'TaskForge',
      email: 'hi@acme.test',
    });
  });
});

describe('the Brevo transport', () => {
  const original = { key: env.BREVO_API_KEY, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO };
  let fetchMock: ReturnType<typeof vi.fn>;

  function lastBody(): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
  }

  beforeEach(() => {
    // `env` is a parsed plain object. Writing to it is not something the app
    // ever does, and is the least ceremonious way to test a config branch.
    Object.assign(env, {
      BREVO_API_KEY: 'xkeysib-test',
      EMAIL_FROM: 'TaskForge <no-reply@acme.test>',
      EMAIL_REPLY_TO: undefined,
    });

    fetchMock = vi.fn().mockResolvedValue(new Response('{"messageId":"<1@brevo>"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(env, {
      BREVO_API_KEY: original.key,
      EMAIL_FROM: original.from,
      EMAIL_REPLY_TO: original.replyTo,
    });
  });

  it('posts to the Brevo API with the key in a header', async () => {
    await brevoTransport.send({ to: 'someone@example.test', subject: 'Hi', text: 'Hello' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe('xkeysib-test');
  });

  it('splits EMAIL_FROM into the sender object Brevo expects', async () => {
    await brevoTransport.send({ to: 'someone@example.test', subject: 'Hi', text: 'Hello' });

    expect(lastBody().sender).toEqual({ name: 'TaskForge', email: 'no-reply@acme.test' });
    expect(lastBody().to).toEqual([{ email: 'someone@example.test' }]);
  });

  it('omits htmlContent entirely for a text-only message', async () => {
    // Brevo rejects an empty string here. Sending `htmlContent: ''` — which is
    // what a naive `html ?? ''` produces — fails every plain-text email.
    await brevoTransport.send({ to: 'someone@example.test', subject: 'Hi', text: 'Hello' });

    expect(lastBody()).not.toHaveProperty('htmlContent');
  });

  it('gives up rather than waiting indefinitely', async () => {
    await brevoTransport.send({ to: 'someone@example.test', subject: 'Hi', text: 'Hello' });

    // The whole point of this transport is that it cannot hang. A request with
    // no abort signal would reintroduce the bug over a different protocol.
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces the provider's own explanation, not just the status", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
    );

    // 401 alone sends you looking in the wrong place. "Key not found" tells
    // you which of the two credentials on that Brevo page you copied.
    await expect(
      brevoTransport.send({ to: 'someone@example.test', subject: 'Hi', text: 'Hello' }),
    ).rejects.toThrow(/Key not found.*unauthorized/);
  });

  it('does not choke when the failure is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    await expect(
      brevoTransport.send({ to: 'someone@example.test', subject: 'Hi', text: 'Hello' }),
    ).rejects.toThrow(/502/);
  });
});

describe('email is never on the critical path of a request', () => {
  /* The regression guard for the actual bug.

     `sendEmail` resolves when the provider answers; `queueEmail` returns
     immediately. Both are correct in their place, and the place for anything
     inside a request handler is `queueEmail`. This asserts that directly
     rather than trusting it, because the failure mode is a slow request
     rather than a broken one — nothing goes red, it just gets worse. */

  function sourceFiles(dir: string): string[] {
    const found: string[] = [];

    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(full);
    }

    return found;
  }

  it('no request handler awaits sendEmail', () => {
    // __dirname, not import.meta — this project compiles to CommonJS.
    const modules = join(__dirname, '..', '..', 'modules');

    const offenders = sourceFiles(modules).filter((file) =>
      /\bawait\s+sendEmail\s*\(/.test(readFileSync(file, 'utf8')),
    );

    expect(
      offenders.map((f) => relative(join(__dirname, '..', '..'), f).split(sep).join('/')),
    ).toEqual([]);
  });
});
