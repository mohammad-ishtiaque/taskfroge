import { afterEach, describe, expect, it, vi } from 'vitest';

import { aProject, aTask, fakeApi, requestAs, someStats } from './harness';

/* ==========================================================================
   What each role's screens actually do
   --------------------------------------------------------------------------
   Every test here is a bug that shipped. Not a hypothetical — each one was
   found by a person clicking, after both repos typechecked clean.

   The shape of all of them is the same: a function that is correct for a
   project manager, called with a different role. TypeScript cannot see it,
   because a role is a string and every branch typechecks. Only calling it can.
   ========================================================================== */

afterEach(() => vi.unstubAllGlobals());

describe('the task detail loader', () => {
  it('does not call the managers-only endpoint for a developer', async () => {
    // The bug: the gate asked "is this a client", but `/assignable` is
    // managers-only. A developer opening *any* task was refused with
    // "This action requires: PROJECT_MANAGER" and got a stack trace.
    const { calls } = fakeApi([
      { route: 'GET /tasks/WEB-1', body: aTask() },
      { route: 'GET /tasks/WEB-1/comments', body: [] },
      { route: 'GET /projects/WEB/members', body: [] },
    ]);

    const { loader } = await import('~/routes/w.$slug.tasks.$taskKey');

    const data = await loader({
      request: await requestAs('DEVELOPER', 'http://localhost/w/acme/tasks/WEB-1'),
      params: { slug: 'acme', taskKey: 'WEB-1' },
      context: {} as never,
    } as never);

    expect(calls).not.toContain('GET /projects/WEB/assignable');
    expect((data as { canAssign: boolean }).canAssign).toBe(false);
  });

  it('fetches members, not assignable, when it does fetch people', async () => {
    // The second bug in the same line: `assignable` is everyone who is *not*
    // on the project. Picking a name from it produced a task assigned to
    // someone who could not open it, which the API then refused.
    const { calls } = fakeApi([
      { route: 'GET /tasks/WEB-1', body: aTask() },
      { route: 'GET /tasks/WEB-1/comments', body: [] },
      { route: 'GET /projects/WEB/members', body: [] },
    ]);

    const { loader } = await import('~/routes/w.$slug.tasks.$taskKey');

    await loader({
      request: await requestAs('PROJECT_MANAGER', 'http://localhost/w/acme/tasks/WEB-1'),
      params: { slug: 'acme', taskKey: 'WEB-1' },
      context: {} as never,
    } as never);

    expect(calls).toContain('GET /projects/WEB/members');
    expect(calls).not.toContain('GET /projects/WEB/assignable');
  });
});

describe('the project settings loader', () => {
  it('refuses anyone who is not a project manager', async () => {
    // The tab bar offered this to developers and the route answered 404 — the
    // two disagreed about who the screen was for, and the route was right.
    // This asserts the route's half; the tab bar's half is below.
    fakeApi([]);

    const { loader } = await import('~/routes/w.$slug.projects.$key.settings');

    const call = loader({
      request: await requestAs('DEVELOPER', 'http://localhost/w/acme/projects/WEB/settings'),
      params: { slug: 'acme', key: 'WEB' },
      context: {} as never,
    } as never);

    await expect(call).rejects.toMatchObject({ status: 404 });
  });

  it('lets a project manager through', async () => {
    fakeApi([
      { route: 'GET /projects/WEB', body: aProject() },
      { route: 'GET /projects/WEB/members', body: [] },
    ]);

    const { loader } = await import('~/routes/w.$slug.projects.$key.settings');

    const data = await loader({
      request: await requestAs('PROJECT_MANAGER', 'http://localhost/w/acme/projects/WEB/settings'),
      params: { slug: 'acme', key: 'WEB' },
      context: {} as never,
    } as never);

    expect((data as { project: { key: string } }).project.key).toBe('WEB');
  });
});

describe('the project layout loader', () => {
  it('marks a developer as neither client nor manager', async () => {
    // `isManager` is what hides the Settings tab. It did not exist — the tab
    // was hidden with `isClient`, so developers were shown a 404.
    fakeApi([
      { route: 'GET /projects/WEB', body: aProject() },
      { route: 'GET /projects/WEB/stats', body: someStats() },
    ]);

    const { loader } = await import('~/routes/w.$slug.projects.$key');

    const data = (await loader({
      request: await requestAs('DEVELOPER', 'http://localhost/w/acme/projects/WEB'),
      params: { slug: 'acme', key: 'WEB' },
      context: {} as never,
    } as never)) as { isClient: boolean; isManager: boolean };

    expect(data.isClient).toBe(false);
    expect(data.isManager).toBe(false);
  });
});
