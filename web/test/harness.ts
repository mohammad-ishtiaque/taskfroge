import { vi } from 'vitest';

/* ==========================================================================
   Calling a loader the way React Router does
   --------------------------------------------------------------------------
   A loader is an async function that takes a Request and returns data. That is
   the whole interface, and it means these tests need no browser, no dev
   server and no router — just a Request, a signed session cookie, and a fake
   API to answer the calls the loader makes.

   The fake is the important part. Every bug this suite exists to catch lived
   in the space between "what the API returns" and "what the screen reads", so
   the fake answers with the shapes the API's own smoke tests assert. If those
   two drift, one of the two suites goes red.
   ========================================================================== */

export interface FakeRoute {
  /** `GET /projects/WEB`. Matched exactly, after query strings are stripped. */
  route: string;
  status?: number;
  body?: unknown;
  /** For the failure paths: `{ code, message }` in an error envelope. */
  error?: { code: string; message?: string; details?: Record<string, unknown> };
}

/**
 * Replaces `fetch` for the duration of a test.
 *
 * Returns the list of calls made, because "which endpoints did this screen
 * hit" is itself worth asserting — a loader that quietly calls a
 * managers-only endpoint for everybody is exactly the bug that put a stack
 * trace in front of every developer.
 */
export function fakeApi(routes: FakeRoute[]) {
  const calls: string[] = [];

  const handler = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname.replace(/^\/api\/v1/, '')}`;

    calls.push(key);

    const match = routes.find((r) => r.route === key);

    if (!match) {
      // Loud on purpose. A silent 404 from the fake sends the test down the
      // loader's error branch and the failure message then describes the
      // wrong thing entirely.
      throw new Error(
        `fakeApi has no route for "${key}".\n` +
          `  Known: ${routes.map((r) => r.route).join(', ') || '(none)'}`,
      );
    }

    const envelope = match.error
      ? { success: false, error: match.error, meta: { requestId: 'test', timestamp: '' } }
      : { success: true, data: match.body, meta: { requestId: 'test', timestamp: '' } };

    return new Response(JSON.stringify(envelope), {
      status: match.status ?? (match.error ? 400 : 200),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', handler);
  return { calls };
}

/**
 * A Request carrying a session for someone with this role.
 *
 * Built through the real cookie helpers rather than a hand-written header, so
 * a change to how sessions are signed breaks these tests rather than silently
 * making them test nothing.
 */
export async function requestAs(
  role: 'PROJECT_MANAGER' | 'DEVELOPER' | 'CLIENT',
  url = 'http://localhost/',
  overrides: { id?: string } = {},
): Promise<Request> {
  const { commitSession, getSession, setTokens } = await import('~/lib/session.server');

  const session = await getSession(new Request(url));

  session.set('user', {
    id: overrides.id ?? `user-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@example.test`,
    name: 'Test Person',
    role,
    orgId: 'org-1',
    orgName: 'Test Agency',
    locale: 'en',
  });

  setTokens(session, {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    // Comfortably in the future, so `requireUser` does not bounce the test to
    // /refresh-session — which would look like the loader refusing.
    expiresInSeconds: 3600,
  });

  return new Request(url, { headers: { Cookie: await commitSession(session) } });
}

/** A project in the shape `serialize.ts` produces. Override what a test cares about. */
export function aProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-1',
    workspaceId: 'workspace-1',
    key: 'WEB',
    name: 'FreshCart Storefront',
    description: '',
    status: 'ACTIVE',
    priority: 'HIGH',
    startDate: null,
    endDate: null,
    leadId: null,
    archivedAt: null,
    memberIds: ['user-project_manager'],
    memberCount: 1,
    progress: 0,
    visibility: {
      preset: 'OPEN',
      showBoard: true,
      showAssignees: true,
      showDueDates: true,
      showTimeTracking: false,
      showBlockedReasons: true,
      showAttachments: true,
    },
    members: [],
    invitations: [],
    ...overrides,
  };
}

/** Stats in the shape the API returns — every enum key present, zero-filled. */
export function someStats(overrides: Record<string, unknown> = {}) {
  return {
    totalTasks: 1,
    completedTasks: 0,
    inProgressTasks: 1,
    overdueTasks: 0,
    teamSize: 3,
    completionRate: 0,
    byStatus: { TODO: 0, IN_PROGRESS: 1, IN_REVIEW: 0, BLOCKED: 0, DONE: 0 },
    byType: { TASK: 1, BUG: 0, STORY: 0, CHORE: 0 },
    byPriority: { URGENT: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
    ...overrides,
  };
}

export function aTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    key: 'WEB-1',
    projectId: 'project-1',
    parentId: null,
    title: 'Sign in with Google',
    description: '',
    type: 'STORY',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    assigneeId: null,
    reporterId: 'user-project_manager',
    dueDate: null,
    estimateHours: null,
    loggedHours: 0,
    blockedReason: null,
    clientVisible: true,
    labels: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    assignee: null,
    reporter: null,
    subtasks: [],
    project: { id: 'project-1', key: 'WEB', name: 'FreshCart', workspaceId: 'workspace-1', visibility: null },
    ...overrides,
  };
}
