import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/* ==========================================================================
   Proving who is asking
   --------------------------------------------------------------------------
   A password reset, and an email OTP, each involve two moments:

       1. someone asks for it          — "I forgot my password"
       2. someone completes it         — "here is the token, set this password"

   The obvious implementation links them with one secret: a token, emailed, and
   presented back. That proves control of the inbox at step 2. It proves
   nothing about step 1, and the two need not be the same person.

   That matters more than it first appears. The emailed link is a bearer
   credential with a long half-life. It sits in an inbox that may be shared,
   forwarded, synced to a second device, indexed by a mail client, or read by
   anyone who has the mailbox open. Whoever holds it owns the account, and the
   server cannot tell the difference between the owner and a bystander.

   So: two secrets.

       token       → sent to the inbox      → proves you can read the email
       challenge   → set as a cookie on the → proves you are the browser that
                     requesting browser        started this

   Completing the flow requires both. An attacker with only the forwarded link
   has no challenge cookie. An attacker who starts a reset for someone else's
   address has the cookie but never sees the token. Neither is sufficient
   alone, and that is the property the single-secret design lacks.

   ── The cross-device objection ──────────────────────────────────────────
   People request a reset on a laptop and open the email on a phone. Under a
   strict rule that fails, which is why the escape hatch exists: the email also
   carries a 6-digit code. Typing that code in the *new* browser starts a fresh
   challenge bound to it. You still cannot complete a reset you did not start —
   you have simply started a new one, from the device you are actually holding.

   ── Why not just fingerprint the IP or user-agent ───────────────────────
   Both were considered and rejected as the primary binding. Mobile IPs change
   mid-session, corporate NATs make thousands of people identical, and a
   user-agent is not a secret — an attacker reading the email can trivially
   copy the header. They are recorded for the *notification* ("requested from
   Chrome on Windows, 103.x.x.x"), because a human reading that can spot a
   request they did not make. They are not used as a gate.
   ========================================================================== */

/** Rotated per request. 32 bytes is far past guessing. */
const CHALLENGE_BYTES = 32;

export const RESET_CHALLENGE_COOKIE = 'tf_reset_challenge';
export const VERIFY_CHALLENGE_COOKIE = 'tf_verify_challenge';

export interface Challenge {
  /** Handed to the browser. Never stored. */
  secret: string;
  /** Stored on the row. Never leaves the server. */
  hash: string;
}

export function createChallenge(): Challenge {
  const secret = randomBytes(CHALLENGE_BYTES).toString('base64url');
  return { secret, hash: hashChallenge(secret) };
}

export function hashChallenge(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * A 6-digit code, uniformly distributed.
 *
 * `randomInt` rather than `Math.random`: this is a credential, and a
 * predictable one is not a credential. Leading zeros are preserved by padding,
 * because "042931" has the same entropy as "942931" and dropping the zero
 * would quietly shrink the space.
 */
export function createOtp(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

/**
 * Compares two hex digests without leaking how far they matched.
 *
 * Overkill for a hash comparison in most threat models, and free here. The
 * habit is what matters: the day this is used on something shorter, the
 * constant-time version is already the one in use.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ── Where the cookie lives ─────────────────────────────────────────────────

   Not here. This API never speaks to a browser: every request arrives from the
   web server acting for the user, so a `Set-Cookie` written on these responses
   would be stored by the web server rather than by the person. The challenge
   secret is returned in the response body instead, and the web tier — which is
   the thing holding the browser's connection — writes it as an httpOnly
   cookie. See `web/app/lib/challenge.server.ts`.

   The security property is unchanged. The secret is generated here, never
   appears in the email, and is only ever held by the browser that asked. What
   moves is which server sets the header.
   ────────────────────────────────────────────────────────────────────────── */

/* ── Request context ────────────────────────────────────────────────────── */

/**
 * What we tell the user about where a request came from.
 *
 * The IP is truncated before storage — the last octet of IPv4 and the host
 * portion of IPv6 are dropped. "103.152.44.x" is enough for a person to
 * recognise their own network, and keeping the rest would mean storing a
 * precise location trace against every password reset for no added benefit.
 */
export function describeRequest(req: Request): { ip: string; agent: string } {
  const raw =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.ip ??
    '';

  return { ip: truncateIp(raw), agent: summariseAgent(req.headers['user-agent'] ?? '') };
}

function truncateIp(ip: string): string {
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    // IPv6 — keep the routing prefix, drop the interface identifier.
    return `${ip.split(':').slice(0, 3).join(':')}::x`;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.x` : 'unknown';
}

/**
 * "Chrome on Windows" rather than a 140-character UA string.
 *
 * The email is read by a person deciding whether they recognise the request.
 * A raw user-agent tells them nothing they can act on.
 */
function summariseAgent(ua: string): string {
  if (!ua) return 'an unknown browser';

  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'a browser';

  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'an unknown system';

  return `${browser} on ${os}`;
}

/* ── Attempt limiting ───────────────────────────────────────────────────── */

/**
 * How many wrong codes before the row is burned.
 *
 * Six digits is a million possibilities, which sounds ample and is not: at a
 * few hundred requests a second an unlimited endpoint falls in under an hour.
 * Five attempts leaves a genuine typo comfortable room and reduces an attacker
 * to a 1-in-200,000 shot per issued code.
 *
 * Exceeding it invalidates the code rather than pausing — a lockout that
 * expires is a lockout an attacker waits out.
 */
export const MAX_OTP_ATTEMPTS = 5;

/** Short. A code that lives an hour is a code sitting in an inbox for an hour. */
export const OTP_TTL_MS = 15 * 60_000;

/** Long enough to find the email, short enough to matter. */
export const RESET_TTL_MS = 60 * 60_000;

/** Stops "resend" being a free way to spray codes at an address. */
export const RESEND_COOLDOWN_MS = 60_000;

/** Per address, per day. Beyond this the address is being used as a weapon. */
export const MAX_SENDS_PER_DAY = 10;
