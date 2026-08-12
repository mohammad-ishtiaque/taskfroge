import { redirect } from 'react-router';
import type { Route } from './+types/logout';
import { callApi } from '~/lib/api.server';
import { destroySession, getSession } from '~/lib/session.server';

/**
 * Sign out.
 *
 * POST only — a GET would let an `<img src="/logout">` on any page sign the
 * user out, which is a small but real CSRF nuisance.
 */
export async function action({ request }: Route.ActionArgs) {
  // Revoke server-side too, so the refresh token cannot be reused if it was
  // captured. Best-effort: if the API is down, still clear the cookie.
  await callApi('/auth/logout', { method: 'POST', request }).catch(() => undefined);

  const session = await getSession(request);

  return redirect('/login', {
    headers: { 'Set-Cookie': await destroySession(session) },
  });
}

export function loader() {
  return redirect('/');
}
