import { redirect } from 'react-router';
import type { Route } from './+types/refresh-session';
import { callApi } from '~/lib/api.server';
import { commitSession, destroySession, getSession, setTokens } from '~/lib/session.server';

/**
 * Exchanges the refresh token for a fresh access token, then sends the user
 * back where they were going.
 *
 * A route rather than an inline call because only a route can set a cookie,
 * and the rotated refresh token must be persisted — the API invalidates the
 * old one, so losing the new one logs the user out on their next click.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const refreshToken = session.get('refreshToken');

  const requested = new URL(request.url).searchParams.get('next') ?? '/';
  // Same-origin only. Without this, `?next=https://evil.test` would bounce a
  // freshly refreshed user off-site with a valid session.
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  if (!refreshToken) {
    throw redirect('/login', { headers: { 'Set-Cookie': await destroySession(session) } });
  }

  try {
    const tokens = await callApi<{
      accessToken: string;
      refreshToken: string;
      expiresInSeconds: number;
    }>('/auth/refresh', { method: 'POST', body: { refreshToken } });

    setTokens(session, tokens);

    return redirect(next, { headers: { 'Set-Cookie': await commitSession(session) } });
  } catch {
    // Expired, revoked, or replayed. All of them mean the same thing to the
    // user, and none of them are recoverable without signing in again.
    throw redirect(`/login?redirectTo=${encodeURIComponent(next)}`, {
      headers: { 'Set-Cookie': await destroySession(session) },
    });
  }
}
