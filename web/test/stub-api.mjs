// Stand-in for taskforge-api, speaking the same envelope. Lets the web app be
// exercised end to end without Prisma, which cannot run in this sandbox.
import { createServer } from 'node:http';

const ok = (data) => JSON.stringify({
  success: true, data,
  meta: { requestId: 'stub', timestamp: new Date().toISOString() },
});
const err = (code, message) => JSON.stringify({
  success: false, error: { code, message },
  meta: { requestId: 'stub', timestamp: new Date().toISOString() },
});

const PROJECTS = [
  { id: 'p1', key: 'WEB', name: 'FreshCart Web', description: 'Storefront rebuild',
    status: 'ACTIVE', createdAt: new Date().toISOString(), _count: { members: 3 } },
];

const PROJECT_DETAIL = {
  id: 'p1', key: 'WEB', name: 'FreshCart Web', description: 'Storefront rebuild',
  status: 'ACTIVE', createdAt: new Date().toISOString(),
  visibility: { preset: 'OPEN', showBoard: true, showAssignees: true, showDueDates: true,
                showTimeTracking: false, showBlockedReasons: true, showAttachments: true },
  members: [
    // The signed-in user. Their own row has no Remove button — you cannot
    // remove yourself — so a second member is needed to exercise that path.
    { id: 'm1', addedAt: new Date().toISOString(),
      user: { id: 'u1', name: 'Priya Nair', email: 'pm@taskforge.test', avatarUrl: null } },
    { id: 'm2', addedAt: new Date().toISOString(),
      user: { id: 'u2', name: 'Rahim Chowdhury', email: 'dev@taskforge.test', avatarUrl: null } },
  ],
  invitations: [
    { id: 'i1', email: 'newdev@example.test', role: 'DEVELOPER',
      expiresAt: new Date(Date.now() + 6 * 86400000).toISOString() },
  ],
};

const SESSION = {
  accessToken: 'stub-access', refreshToken: 'stub-refresh', expiresInSeconds: 900,
  user: { id: 'u1', email: 'pm@taskforge.test', name: 'Priya Nair',
          avatarUrl: null, locale: 'en', timezone: 'UTC' },
  organization: { id: 'o1', name: 'Moob02 Software', slug: 'moob02', role: 'PROJECT_MANAGER' },
};

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const payload = body ? JSON.parse(body) : {};

    if (req.url === '/api/v1/auth/login') {
      if (payload.password === 'TaskForge123!') { res.end(ok(SESSION)); return; }
      res.statusCode = 401;
      res.end(err('INVALID_CREDENTIALS', 'Email or password is incorrect'));
      return;
    }
    if (req.url === '/api/v1/auth/register') { res.statusCode = 201; res.end(ok(SESSION)); return; }
    if (req.url === '/api/v1/auth/logout') { res.end(ok({ loggedOut: true })); return; }
    if (req.url === '/api/v1/auth/refresh') {
      if (payload.refreshToken === 'dead-refresh') {
        res.statusCode = 401; res.end(err('TOKEN_INVALID', 'session ended')); return;
      }
      res.end(ok({ accessToken: 'stub-access-2', refreshToken: 'stub-refresh-2',
                   expiresInSeconds: 900 }));
      return;
    }
    if (req.url === '/api/v1/auth/logout-all') { res.end(ok({ revokedSessions: 2 })); return; }
    if (req.url === '/api/v1/auth/change-password') {
      if (payload.currentPassword === 'TaskForge123!') { res.end(ok({ message: 'ok' })); return; }
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false,
        error: { code: 'VALIDATION_FAILED', message: 'wrong',
                 details: { issues: { currentPassword: ['Incorrect password'] } } },
        meta: { requestId: 'stub', timestamp: new Date().toISOString() } }));
      return;
    }
    if (req.url === '/api/v1/auth/forgot-password') { res.end(ok({ message: 'sent' })); return; }

    // ── M1 ──────────────────────────────────────────────────────────────────
    if (req.url === '/api/v1/projects' && req.method === 'GET') {
      res.end(ok(PROJECTS)); return;
    }
    if (req.url === '/api/v1/projects' && req.method === 'POST') {
      // Mirror the real zod rule. A stub that is more permissive than the API
      // turns "the server rejects this" into a test that cannot fail.
      if (!/^[A-Za-z]{2,8}$/.test(payload.key ?? '')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false,
          error: { code: 'VALIDATION_FAILED', message: 'Invalid',
                   details: { issues: { key: ['Letters only — no digits, spaces or punctuation'] } } },
          meta: { requestId: 'stub', timestamp: new Date().toISOString() } }));
        return;
      }
      if (payload.key === 'DUPE') {
        res.statusCode = 409;
        res.end(JSON.stringify({ success: false,
          error: { code: 'ALREADY_EXISTS', message: 'taken', details: { fields: ['key'] } },
          meta: { requestId: 'stub', timestamp: new Date().toISOString() } }));
        return;
      }
      res.statusCode = 201;
      res.end(ok({ project: { id: 'p1', key: payload.key, name: payload.name }, invitations: [] }));
      return;
    }
    if (req.url?.includes('/assignable')) {
      res.end(ok([
        { id: 'u3', name: 'Yusuf Demir', email: 'qa@taskforge.test',
          memberships: [{ role: 'DEVELOPER' }] },
      ]));
      return;
    }
    if (req.url?.endsWith('/members') && req.method === 'POST') {
      res.statusCode = 201; res.end(ok({ id: 'm3' })); return;
    }
    if (req.url?.startsWith('/api/v1/projects/WEB/invitations')) {
      res.statusCode = 201; res.end(ok({ email: payload.email, role: payload.role })); return;
    }
    if (req.url?.startsWith('/api/v1/projects/')) {
      res.end(ok(PROJECT_DETAIL)); return;
    }
    if (req.url?.startsWith('/api/v1/invitations/preview')) {
      const token = new URL(req.url, 'http://x').searchParams.get('token');
      if (token === 'expired-token-000000000000000000') {
        res.statusCode = 400;
        res.end(err('INVITATION_INVALID', 'no longer valid')); return;
      }
      res.end(ok({ email: 'newdev@example.test', role: 'DEVELOPER',
                   projectName: 'FreshCart Web', organizationName: 'Moob02 Software',
                   invitedByName: 'Priya Nair', hasAccount: false }));
      return;
    }
    if (req.url === '/api/v1/invitations/accept') {
      res.end(ok({ userId: 'u2', orgId: 'o1', projectId: 'p1', isNewAccount: true })); return;
    }

    res.statusCode = 404;
    res.end(err('NOT_FOUND', 'stub'));
  });
}).listen(4111, () => console.log('stub api on 4111'));
