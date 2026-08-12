import { redirect } from 'react-router';

import type { Route } from './+types/switch-organization';
import { ApiError } from '~/lib/api.server';
import { switchOrganization } from '~/data/gateway.server';
import { commitSession, getSession, requireUser, setTokens } from '~/lib/session.server';

/* ==========================================================================
   Move this browser to another organisation.

   POST only, and no component: there is nothing to render, and a GET that
   changed which account you are looking at would fire on a prefetch, a link
   preview, or a crawler.

   The API revokes the old session as it issues the new one, so by the time
   this action resolves the cookie in the browser is already worthless.
   Everything after the call is about making sure the replacement is written —
   a `throw` between here and `commitSession` would sign the person out.
   ========================================================================== */

export async function loader() {
  // Somebody typed the URL, or a bookmark points here. Not an error.
  return redirect('/');
}

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);

  const formData = await request.formData();
  const organizationId = String(formData.get('organizationId') ?? '');

  if (!organizationId) return redirect('/');

  let result;
  try {
    result = await switchOrganization(request, organizationId);
  } catch (error) {
    // 404 is what the API answers for "no such organisation" *and* for "you
    // are not a member of it", deliberately — distinguishing them would let a
    // signed-in person discover which organisation ids exist. Either way the
    // right response here is to leave them where they were.
    if (error instanceof ApiError && error.status === 404) {
      return redirect('/?switch=unavailable');
    }
    throw error;
  }

  const session = await getSession(request);
  setTokens(session, result);
  session.set('user', {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    // From the new organisation's membership. Someone who is a project
    // manager in their own workspace is whatever they were invited as in
    // yours, and the shell must be built from the second, not the first.
    role: result.organization.role,
    orgId: result.organization.id,
    orgName: result.organization.name,
    locale: result.user.locale,
  });

  /* Home, and not the workspace they were looking at — that slug belongs to
     the organisation they just left and is a 404 under the new session. Home
     resolves a workspace for whoever is asking.

     Resolving it here instead would not work, and the reason is worth naming:
     `getAccessToken` prefers the live token held in AsyncLocalStorage for the
     duration of a request, which is still the old one. This request cannot
     call the API as the new session no matter what it puts in the cookie. The
     redirect is what gets us a request that can. */
  return redirect('/', { headers: { 'Set-Cookie': await commitSession(session) } });
}
