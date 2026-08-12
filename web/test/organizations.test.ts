import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, requestAs } from './harness';

/* ==========================================================================
   Belonging to two workspaces
   --------------------------------------------------------------------------
   Reported from production, and worth restating because the symptom pointed
   away from the cause: an invitation was accepted, the inviting manager's
   dashboard said "accepted", and the project never appeared for the person
   who joined.

   Nothing was wrong with the data. Everything is scoped by the `orgId` signed
   into the access token, and that token was minted against the workspace they
   had registered themselves — the oldest membership, which is what `login`
   took. The second membership existed and had no way to be reached.

   The API suite proves the endpoints. This proves the two things the web tier
   is responsible for: that the switcher is given something to render, and
   that switching writes the *new* organisation's role into the cookie.
   ========================================================================== */

afterEach(() => vi.unstubAllGlobals());

/** The six calls the shell makes, with the switcher's answer configurable. */
function shellRoutes(organizations: unknown[]) {
  return [
    { route: 'GET /workspaces', body: [WORKSPACE] },
    { route: 'GET /workspaces/acme', body: WORKSPACE },
    { route: 'GET /notifications', body: { items: [], unread: 0 } },
    { route: 'GET /auth/organizations', body: organizations },
    { route: 'GET /projects', body: [] },
    { route: 'GET /tasks/mine', body: [] },
  ];
}

const WORKSPACE = {
  id: 'workspace-1',
  slug: 'acme',
  name: 'Acme',
  clientName: 'Acme Ltd',
  memberCount: 1,
  projectCount: 0,
};

const OWN = {
  id: 'org-2',
  slug: 'okafor-studio',
  name: 'Okafor Studio',
  role: 'PROJECT_MANAGER',
  current: false,
};

const AGENCY = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme',
  role: 'DEVELOPER',
  current: true,
};

describe('the shell', () => {
  it('gives the sidebar the organisations it needs to offer a switch', async () => {
    const { calls } = fakeApi(shellRoutes([AGENCY, OWN]));

    const { getShellData } = await import('~/lib/shell.server');
    const data = await getShellData(await requestAs('DEVELOPER', 'http://localhost/w/acme'), 'acme');

    // Without this the switcher renders nothing and the second workspace is
    // as unreachable in the interface as it was in the token.
    expect(data.organizations).toHaveLength(2);
    expect(calls).toContain('GET /auth/organizations');
  });

  it('reports the role held in each, not the role of the current session', async () => {
    fakeApi(shellRoutes([AGENCY, OWN]));

    const { getShellData } = await import('~/lib/shell.server');
    const data = await getShellData(await requestAs('DEVELOPER', 'http://localhost/w/acme'), 'acme');

    // The viewer is a developer here and a manager there. A switcher that
    // showed one role for both would be actively misleading — it is the
    // thing that tells you what you will be able to do after switching.
    const roles = Object.fromEntries(data.organizations.map((o) => [o.id, o.role]));
    expect(roles).toEqual({ 'org-1': 'DEVELOPER', 'org-2': 'PROJECT_MANAGER' });
  });
});

describe('switching organisation', () => {
  /**
   * A form POST carrying a developer's session.
   *
   * The body is a string rather than `URLSearchParams`: these tests run in
   * jsdom, whose `URLSearchParams` is a different class from the one the
   * Request constructor checks against, and the failure names the type it was
   * handed as proof that it is not that type.
   */
  async function postForm(body: string) {
    return new Request('http://localhost/switch-organization', {
      method: 'POST',
      headers: {
        Cookie: (await requestAs('DEVELOPER')).headers.get('Cookie')!,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }

  /** Reads the session back out of the response's Set-Cookie. */
  async function sessionFrom(response: Response) {
    const { getSession } = await import('~/lib/session.server');
    const cookie = response.headers.get('Set-Cookie');
    expect(cookie, 'the action must write a session').toBeTruthy();

    return getSession(new Request('http://localhost/', { headers: { Cookie: cookie! } }));
  }

  it('writes the new organisation and its role into the session', async () => {
    fakeApi([
      {
        route: 'POST /auth/switch-organization',
        body: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresInSeconds: 900,
          user: { id: 'user-developer', email: 'dev@example.test', name: 'Sam', locale: 'en' },
          organization: {
            id: 'org-2',
            name: 'Okafor Studio',
            slug: 'okafor-studio',
            role: 'PROJECT_MANAGER',
          },
        },
      },
    ]);

    const request = await postForm('organizationId=org-2');

    const { action } = await import('~/routes/switch-organization');
    const response = (await action({ request, params: {}, context: {} as never } as never)) as Response;

    const session = await sessionFrom(response);

    /* The assertion this file exists for. The caller was a DEVELOPER; the
       organisation they moved to has them as PROJECT_MANAGER. Copying the
       role from the current session — the obvious shortcut, since it is
       already in the cookie — would make every invited contractor a manager
       of the agency that invited them. */
    expect(session.get('user')?.role).toBe('PROJECT_MANAGER');
    expect(session.get('user')?.orgId).toBe('org-2');

    // And the tokens are replaced. The API revoked the old pair as it issued
    // these, so keeping them would sign the person out rather than merely
    // leaving them unswitched.
    expect(session.get('accessToken')).toBe('new-access');
    expect(session.get('refreshToken')).toBe('new-refresh');
  });

  it('leaves the session alone when the API refuses', async () => {
    fakeApi([
      {
        route: 'POST /auth/switch-organization',
        status: 404,
        error: { code: 'NOT_FOUND', message: 'Workspace not found' },
      },
    ]);

    const request = await postForm('organizationId=org-nope');

    const { action } = await import('~/routes/switch-organization');
    const response = (await action({ request, params: {}, context: {} as never } as never)) as Response;

    // A redirect, not a crash, and emphatically not a new cookie. 404 is what
    // the API answers both for "no such organisation" and for "you are not a
    // member of it" — the two must stay indistinguishable from out here.
    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });
});
