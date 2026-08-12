import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

/**
 * Every route in the app.
 *
 * The rule this file is held to: **nothing here is a placeholder, and nothing
 * linked to from a screen is missing from here.** A sidebar entry pointing at
 * an unregistered path is a 404 the user finds before we do, which is exactly
 * what happened when only the workspace index existed.
 */
export default [
  index('routes/home.tsx'),

  /* ── Account and auth ─────────────────────────────────────────────────── */
  route('login', 'routes/login.tsx'),
  route('register', 'routes/register.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('refresh-session', 'routes/refresh-session.tsx'),
  route('account', 'routes/account.tsx'),
  route('accept-invite', 'routes/accept-invite.tsx'),
  route('forgot-password', 'routes/forgot-password.tsx'),
  route('reset-password', 'routes/reset-password.tsx'),
  // POST only. Issues a session for another organisation — see the route.
  route('switch-organization', 'routes/switch-organization.tsx'),

  route('workspaces/new', 'routes/workspaces.new.tsx'),

  /* ── Inside a workspace ───────────────────────────────────────────────
     The layout route supplies the sidebar and top bar, so a screen added
     here gets the frame by existing rather than by remembering to import it. */
  layout('routes/w.$slug.tsx', [
    route('w/:slug', 'routes/w.$slug._index.tsx'),
    route('w/:slug/team', 'routes/w.$slug.team.tsx'),
    route('w/:slug/settings', 'routes/w.$slug.settings.tsx'),
    route('w/:slug/notifications', 'routes/w.$slug.notifications.tsx'),
    route('w/:slug/search', 'routes/w.$slug.search.tsx'),
    route('w/:slug/tasks/:taskKey', 'routes/w.$slug.tasks.$taskKey.tsx'),

    route('w/:slug/projects', 'routes/w.$slug.projects._index.tsx'),
    route('w/:slug/projects/new', 'routes/w.$slug.projects.new.tsx'),

    // The project header and tab bar are a layout, so switching tabs does not
    // re-fetch the stats above them.
    layout('routes/w.$slug.projects.$key.tsx', [
      route('w/:slug/projects/:key', 'routes/w.$slug.projects.$key._index.tsx'),
      route('w/:slug/projects/:key/tasks', 'routes/w.$slug.projects.$key.tasks.tsx'),
      route('w/:slug/projects/:key/board', 'routes/w.$slug.projects.$key.board.tsx'),
      route('w/:slug/projects/:key/calendar', 'routes/w.$slug.projects.$key.calendar.tsx'),
      route('w/:slug/projects/:key/analytics', 'routes/w.$slug.projects.$key.analytics.tsx'),
      route('w/:slug/projects/:key/settings', 'routes/w.$slug.projects.$key.settings.tsx'),
    ]),
  ]),

  /* ── M1 screens, still on the real API ───────────────────────────────── */
  route('projects', 'routes/projects._index.tsx'),
  route('projects/new', 'routes/projects.new.tsx'),
  route('projects/:key', 'routes/projects.$key.tsx'),

  /* ── Progressive web app ─────────────────────────────────────────────── */
  // Cached by the service worker at install and served when a navigation
  // fails. Outside the workspace layout deliberately: the shell needs the API,
  // which is the thing that is missing.
  route('offline', 'routes/offline.tsx'),
  // Short link a push notification points at. The API builds the payload and
  // does not know the workspace slug; this resolves it on the one tap that
  // matters rather than on every send.
  route('t/:taskKey', 'routes/t.$taskKey.tsx'),

  /* ── Resource routes — no UI ─────────────────────────────────────────── */
  route('locale', 'routes/locale.tsx'),
  route('push/subscribe', 'routes/push.subscribe.tsx'),
  route('push/unsubscribe', 'routes/push.unsubscribe.tsx'),
] satisfies RouteConfig;
