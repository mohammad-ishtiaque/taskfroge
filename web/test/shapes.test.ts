import { afterEach, describe, expect, it, vi } from 'vitest';

import { aProject, fakeApi, requestAs, someStats } from './harness';

/* ==========================================================================
   Arithmetic on data the API sent
   --------------------------------------------------------------------------
   The other suite is about roles. This one is about the moment a screen does
   sums on a response, because that is where the second family of bugs lived:
   the value was missing, the arithmetic produced NaN, and React rendered the
   word "NaN" in a stat card without complaint.

   Nothing in TypeScript objects to `undefined + undefined`. The type said
   `Record<TaskStatus, number>` and the API sent `{ IN_PROGRESS: 1 }`, and both
   sides compiled because each believed its own half.
   ========================================================================== */

afterEach(() => vi.unstubAllGlobals());

describe('the analytics loader', () => {
  it('computes an active count that is a number', async () => {
    fakeApi([{ route: 'GET /projects/WEB/stats', body: someStats() }]);

    const { loader } = await import('~/routes/w.$slug.projects.$key.analytics');

    const data = (await loader({
      request: await requestAs('PROJECT_MANAGER', 'http://localhost/w/acme/projects/WEB/analytics'),
      params: { slug: 'acme', key: 'WEB' },
      context: {} as never,
    } as never)) as { active: number };

    expect(Number.isNaN(data.active)).toBe(false);
    expect(data.active).toBe(1);
  });

  it('survives a partial byStatus without printing NaN', async () => {
    // Exactly what `groupBy` used to return: only the rows that exist. The
    // screen added IN_PROGRESS + IN_REVIEW + BLOCKED and got `1 + undefined +
    // undefined`, which is NaN, which React renders as the letters N-a-N.
    //
    // The API is fixed — it zero-fills every enum member now — but a screen
    // that falls over on a missing key is one deploy away from doing it again.
    fakeApi([
      {
        route: 'GET /projects/WEB/stats',
        body: someStats({ byStatus: { IN_PROGRESS: 1 } }),
      },
    ]);

    const { loader } = await import('~/routes/w.$slug.projects.$key.analytics');

    const data = (await loader({
      request: await requestAs('PROJECT_MANAGER', 'http://localhost/w/acme/projects/WEB/analytics'),
      params: { slug: 'acme', key: 'WEB' },
      context: {} as never,
    } as never)) as { active: number };

    expect(Number.isNaN(data.active), 'a missing status key must not become NaN').toBe(false);
  });
});

describe('the project list loader', () => {
  it('asks for archived projects only when the filter says so', async () => {
    // Archiving without a way to see archived projects is a one-way door: the
    // Restore button exists on a screen you can no longer reach.
    const plain = fakeApi([
      { route: 'GET /workspaces/acme', body: { id: 'workspace-1', slug: 'acme' } },
      { route: 'GET /projects', body: [aProject()] },
    ]);

    const { loader } = await import('~/routes/w.$slug.projects._index');

    await loader({
      request: await requestAs('PROJECT_MANAGER', 'http://localhost/w/acme/projects'),
      params: { slug: 'acme' },
      context: {} as never,
    } as never);

    const withoutArchived = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls.map((c) => String(c[0]));

    expect(withoutArchived.some((u) => u.includes('includeArchived'))).toBe(false);
    expect(plain.calls).toContain('GET /projects');

    vi.unstubAllGlobals();

    fakeApi([
      { route: 'GET /workspaces/acme', body: { id: 'workspace-1', slug: 'acme' } },
      { route: 'GET /projects', body: [aProject({ archivedAt: '2026-08-01T00:00:00.000Z' })] },
    ]);

    await loader({
      request: await requestAs('PROJECT_MANAGER', 'http://localhost/w/acme/projects?archived=1'),
      params: { slug: 'acme' },
      context: {} as never,
    } as never);

    const withArchived = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls.map((c) => String(c[0]));

    expect(withArchived.some((u) => u.includes('includeArchived=true'))).toBe(true);
  });
});

describe('the language switcher', () => {
  it('ignores a referer pointing somewhere else', async () => {
    // It read the Referer header and did `new URL(referer).pathname` — an open
    // redirect, and a 500 on any header that would not parse. Click "English"
    // on a page somebody sent you and land on their site, still signed in.
    const { action } = await import('~/routes/locale');

    for (const referer of ['https://evil.test/steal', 'not-a-url', '//evil.test']) {
      const response = (await action({
        request: new Request('http://localhost/locale', {
          method: 'POST',
          body: 'locale=en',
          headers: { Referer: referer, 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
        params: {},
        context: {} as never,
      } as never)) as Response;

      expect(response.headers.get('Location'), `referer ${referer}`).toBe('/');
    }
  });

  it('goes back to the page you were on, when that page is ours', async () => {
    const { action } = await import('~/routes/locale');

    const response = (await action({
      request: new Request('http://localhost/locale', {
        method: 'POST',
        body: 'locale=bn',
        headers: {
          Referer: 'http://localhost/w/acme/projects?status=ACTIVE',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
      params: {},
      context: {} as never,
    } as never)) as Response;

    expect(response.headers.get('Location')).toBe('/w/acme/projects?status=ACTIVE');
  });
});
