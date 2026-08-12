import { redirect } from 'react-router';
import type { MiddlewareFunction } from 'react-router';

import { callApi } from './api.server';
import {
  REFRESH_MARGIN_MS,
  commitSession,
  destroySession,
  getSession,
  setTokens,
  withRequestSession,
} from './session.server';

/* ==========================================================================
   Keeping the session alive
   --------------------------------------------------------------------------
   Access tokens last fifteen minutes. Something has to notice one is about to
   expire and trade the refresh token for a new pair. That job used to live in
   `requireUser`, which meant it ran only on routes that remembered to call it
   — and six did not. The symptom was a tab left open over lunch answering with
   a crash screen:

       ApiError: Token has expired
         at defaultWorkspaceSlug
         at loader (routes/home.tsx)

   `/` never called `requireUser`. Neither did the notifications, search,
   calendar, analytics or new-workspace screens. Every one of them was one
   forgotten line away from working, which is the definition of a rule that
   belongs somewhere else.

   Middleware on the root route is that somewhere else. It runs before every
   loader and action in the app, and it runs *around* them — so it still holds
   the outgoing Response when they are done, which is the only moment a cookie
   can be written.

   That second part is not a convenience. Refresh tokens rotate: the API kills
   the old one the instant it issues a new one, and treats a second use of it
   as theft and revokes the whole session. So a refresh that is not persisted
   does not merely fail to help — it signs the user out on their next click. A
   loader cannot persist it. A loader that throws a redirect, which is what
   most of ours do, cannot even return headers. Middleware can, because React
   Router hands it the finished Response either way.
   ========================================================================== */

/** The route that does its own refreshing. Doing it here too would race it. */
const SKIP = new Set(['/refresh-session']);

const COOKIE_NAME = 'taskforge_session';

/**
 * Did something downstream already write the session cookie?
 *
 * Sign-in, sign-out and the manual refresh route all set it deliberately, and
 * their version is the correct one. Appending ours after sign-out would be the
 * worst case: `destroySession` clears the cookie, our `commitSession` would
 * put a live token straight back, and the browser applies the later header —
 * so "sign out" would leave the user signed in.
 */
function alreadyWroteSession(response: Response): boolean {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('Set-Cookie') ?? ''];

  return cookies.some((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
}

/* ── Refreshing exactly once, however many requests ask ─────────────────── */

interface Rotated {
  accessToken: string;
  refreshToken: string;
  /** Absolute, so a cached answer does not claim more life than it has. */
  expiresAt: number;
}

const inFlight = new Map<string, Promise<Rotated>>();
const recent = new Map<string, Rotated>();

/**
 * How long a rotation stays answerable by the token it replaced.
 *
 * Long enough to cover a browser that fired two requests off the same cookie —
 * a navigation and a fetcher, a prefetch, a second tab — and short enough that
 * a token really is dead soon after it is spent.
 */
const RECENT_MS = 30_000;

/**
 * One refresh per refresh token, no matter how many requests arrive holding it.
 *
 * Without this, rotation is a footgun rather than a defence. Two requests that
 * both find the token stale both call `/auth/refresh`; the API sees the second
 * one present a token it has already spent, correctly concludes it was stolen,
 * and revokes *every session for that user*. The user is thrown out of the
 * product for hovering a link at the wrong moment.
 *
 * So the first caller does the work and the rest wait on it, and the answer
 * stays keyed by the old token for a little while afterwards — because a
 * request that started before the new cookie was sent is still holding the old
 * one through no fault of its own.
 *
 * In-process, which is the honest limit here: two web servers behind a load
 * balancer would each keep their own map and could still collide. Sticky
 * sessions or a shared cache is the answer at that point, and this comment is
 * where to start reading.
 */
async function rotateOnce(refreshToken: string): Promise<Rotated> {
  const now = Date.now();

  for (const [token, value] of recent) {
    if (value.expiresAt < now - RECENT_MS) recent.delete(token);
  }

  const cached = recent.get(refreshToken);
  if (cached) return cached;

  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const promise = callApi<{ accessToken: string; refreshToken: string; expiresInSeconds: number }>(
    '/auth/refresh',
    { method: 'POST', body: { refreshToken } },
  )
    .then((tokens) => {
      const rotated: Rotated = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
      };
      recent.set(refreshToken, rotated);
      setTimeout(() => recent.delete(refreshToken), RECENT_MS).unref?.();
      return rotated;
    })
    .finally(() => inFlight.delete(refreshToken));

  inFlight.set(refreshToken, promise);
  return promise;
}

/**
 * Refreshes the access token when it is close to expiry, and writes the
 * rotated pair back to the cookie on the way out.
 *
 * Deliberately *before* expiry rather than in response to a 401. Reacting to
 * the failure means every stale request costs a wasted round trip and a retry,
 * and the retry has to happen somewhere that can also fix the cookie — which
 * is here anyway. Refreshing a minute early costs one extra call per fifteen
 * minutes and removes the failure case entirely.
 */
export const sessionMiddleware: MiddlewareFunction<Response> = async ({ request }, next) => {
  const url = new URL(request.url);

  // Parsed once and shared with every loader, action and helper in this
  // request. Without that they each get their own copy, and two of them
  // committing produces two cookies where the later one silently drops the
  // other's change.
  const session = await getSession(request);

  const accessToken = session.get('accessToken');
  const refreshToken = session.get('refreshToken');
  const expiresAt = session.get('accessTokenExpiresAt') ?? 0;

  const live = accessToken ? { accessToken, expiresAt } : undefined;

  // Signed out — every public screen lands here — or still comfortably valid,
  // or the one route that refreshes itself.
  if (
    SKIP.has(url.pathname) ||
    !accessToken ||
    !refreshToken ||
    Date.now() < expiresAt - REFRESH_MARGIN_MS
  ) {
    return withRequestSession({ session, tokens: live }, next);
  }

  let tokens: Rotated;

  try {
    tokens = await rotateOnce(refreshToken);
  } catch {
    // Expired, revoked, or already spent by someone else. All three mean the
    // same thing to the person at the keyboard and none are recoverable
    // without signing in. Clearing the cookie matters: a dead refresh token
    // left in it would retry this on every request for the next thirty days.
    const here = `${url.pathname}${url.search}`;
    const target = here === '/' ? '/login' : `/login?redirectTo=${encodeURIComponent(here)}`;

    throw redirect(target, { headers: { 'Set-Cookie': await destroySession(session) } });
  }

  // Seconds remaining, not the original lifetime: a coalesced answer may be a
  // few seconds old, and claiming the full fifteen minutes would push the next
  // refresh past the point the token actually dies.
  setTokens(session, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresInSeconds: Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 1000)),
  });

  const response = await withRequestSession(
    { session, tokens: { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt } },
    next,
  );

  // `append` rather than `set`, so a cookie a loader set for something else
  // survives; and skipped entirely when the route wrote this cookie itself,
  // because it knew something we do not.
  if (!alreadyWroteSession(response)) {
    response.headers.append('Set-Cookie', await commitSession(session));
  }

  return response;
};
