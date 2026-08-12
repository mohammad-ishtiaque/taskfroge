import { AsyncLocalStorage } from 'node:async_hooks';
import { createCookieSessionStorage, redirect } from 'react-router';

/**
 * Server-side session.
 *
 * Tokens live in a signed, httpOnly cookie — never in localStorage, where any
 * injected script can read them. The web server is the only thing that ever
 * holds the access token, and it attaches it to API calls on the user's behalf.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'CLIENT' | 'PROJECT_MANAGER' | 'DEVELOPER';
  orgId: string;
  orgName: string;
  locale: string;
}

interface SessionData {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. Lets us refresh *before* a call fails rather than after. */
  accessTokenExpiresAt: number;
  user: SessionUser;
  locale: string;
}

/**
 * Refresh this far before the token actually expires.
 *
 * Without a margin, a token that is valid when the loader checks it can expire
 * during the API round trip — a race that shows up as a random crash roughly
 * once every 900 requests, which is the worst kind of bug to chase.
 */
export const REFRESH_MARGIN_MS = 60_000;

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error(
    'SESSION_SECRET must be set and at least 32 characters. Copy .env.example to .env.',
  );
}

const storage = createCookieSessionStorage<SessionData>({
  cookie: {
    name: 'taskforge_session',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    secrets: [SESSION_SECRET],
    maxAge: 60 * 60 * 24 * 30,
  },
});

export const commitSession = storage.commitSession;
export const destroySession = storage.destroySession;

export type AppSession = Awaited<ReturnType<typeof storage.getSession>>;

/* ── One session, and one token, per request ────────────────────────────── */

/**
 * Everything about the caller's session that is true *right now*, which is not
 * always what the cookie says.
 *
 * Two problems this solves, both of which only appear once something refreshes
 * mid-request:
 *
 * 1. **The token.** After a refresh the browser's cookie still holds the old
 *    access token — the new one is in a `Set-Cookie` that has not been sent.
 *    A loader reading the cookie would use a token that is already dead.
 *
 * 2. **The session object.** `getSession` parses the cookie afresh on every
 *    call, so the middleware and a route each get their own copy. Both commit,
 *    both produce a `Set-Cookie`, and the last one wins — so the language
 *    switcher and a refresh landing on the same request would silently undo
 *    each other. Sharing one object means both writes land in one cookie.
 *
 * `AsyncLocalStorage` rather than a field on the Request, because React Router
 * hands loaders their own Request instances; and rather than a module-level
 * variable, because requests overlap constantly on a server and a shared
 * variable would hand one person another's token.
 */
interface RequestSession {
  session: AppSession;
  tokens?: { accessToken: string; expiresAt: number };
}

const current = new AsyncLocalStorage<RequestSession>();

/** Runs `fn` with this session and token visible to everything it calls. */
export function withRequestSession<T>(value: RequestSession, fn: () => Promise<T>): Promise<T> {
  return current.run(value, fn);
}

export function currentTokens(): RequestSession['tokens'] {
  return current.getStore()?.tokens;
}

export async function getSession(request: Request): Promise<AppSession> {
  // The middleware's copy, when there is one, so every writer in this request
  // is editing the same object. Falling back to parsing keeps this working
  // outside a request — in tests, and in the middleware's own first call.
  return current.getStore()?.session ?? storage.getSession(request.headers.get('Cookie'));
}

export async function getUser(request: Request): Promise<SessionUser | null> {
  const session = await getSession(request);
  return session.get('user') ?? null;
}

export async function getAccessToken(request: Request): Promise<string | null> {
  // The live token first. Falling back to the cookie keeps every call working
  // if the middleware is ever removed — it would go back to expiring, but it
  // would not start sending no token at all.
  const live = currentTokens();
  if (live) return live.accessToken;

  const session = await getSession(request);
  return session.get('accessToken') ?? null;
}

/**
 * Guards a route. Redirects rather than throwing, and remembers where the user
 * was going so they land there after signing in instead of on a generic home.
 */
/**
 * Guards a protected route.
 *
 * Keeping the token alive is no longer this function's job — the root
 * middleware refreshes before any loader runs, so by the time we get here the
 * token is fresh. What is left is the one question a guard should answer: is
 * anyone signed in, and if not, where were they trying to go.
 *
 * The stale-token branch below is a fallback, not the mechanism. It fires only
 * if the middleware did not run, which today means someone removed it. Reading
 * the *live* expiry rather than the cookie's matters: after a refresh the
 * cookie still says "expired" until the response is sent, and trusting it would
 * bounce the user to `/refresh-session` forever.
 */
export async function requireUser(request: Request): Promise<SessionUser> {
  const session = await getSession(request);
  const user = session.get('user');

  const url = new URL(request.url);
  const here = `${url.pathname}${url.search}`;

  if (!user) {
    const params = new URLSearchParams(here === '/' ? undefined : { redirectTo: here });
    throw redirect(`/login${params.toString() ? `?${params}` : ''}`);
  }

  const expiresAt = currentTokens()?.expiresAt ?? session.get('accessTokenExpiresAt') ?? 0;

  if (Date.now() >= expiresAt - REFRESH_MARGIN_MS) {
    throw redirect(`/refresh-session?next=${encodeURIComponent(here)}`);
  }

  return user;
}

/** Everything a route needs to store after a successful sign-in or refresh. */
export function setTokens(
  session: { set: (key: never, value: never) => void },
  tokens: { accessToken: string; refreshToken: string; expiresInSeconds?: number },
): void {
  const ttl = (tokens.expiresInSeconds ?? 900) * 1000;

  session.set('accessToken' as never, tokens.accessToken as never);
  session.set('refreshToken' as never, tokens.refreshToken as never);
  session.set('accessTokenExpiresAt' as never, (Date.now() + ttl) as never);
}

/** Already signed in — send them home rather than showing the login form. */
export async function redirectIfAuthenticated(request: Request): Promise<void> {
  if (await getUser(request)) throw redirect('/');
}
