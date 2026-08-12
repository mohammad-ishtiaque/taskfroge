import { redirect } from 'react-router';
import type { Route } from './+types/locale';
import { commitSession, getSession } from '~/lib/session.server';
import { isSupportedLocale } from '~/lib/i18n';

/**
 * Resource route with no UI.
 *
 * Stores the language choice in the session cookie so the *server* renders the
 * next page in that language. Doing it client-side would mean a visible flash
 * of the old language on every navigation, and would forget the choice on
 * reload.
 */
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const locale = String(formData.get('locale') ?? '');

  const session = await getSession(request);

  if (isSupportedLocale(locale)) {
    session.set('locale', locale);
  }

  // Back where they came from — a language switch should not navigate.
  //
  // The referer is attacker-influenced, so only its path is used and only when
  // it points at this origin. Without that check a crafted referer turns the
  // language switcher into an open redirect: click "English" on a page someone
  // sent you and land on their site, still signed in.
  const destination = samePathOrHome(request.headers.get('referer'), request.url);

  return redirect(destination, {
    headers: { 'Set-Cookie': await commitSession(session) },
  });
}

/** Nothing to GET here. */
export function loader() {
  return redirect('/');
}

/**
 * The path from a referer, if it is one of ours.
 *
 * `new URL()` throws on a malformed value — and a header is exactly the sort of
 * thing that arrives malformed — so this was the one action in the app that
 * could 500 on input nobody controls.
 */
function samePathOrHome(referer: string | null, current: string): string {
  if (!referer) return '/';

  try {
    const url = new URL(referer);
    if (url.origin !== new URL(current).origin) return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}
