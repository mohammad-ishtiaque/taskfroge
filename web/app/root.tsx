import { useEffect, useMemo } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
  useRouteLoaderData,
} from 'react-router';
import { I18nextProvider } from 'react-i18next';

import type { Route } from './+types/root';
import { createI18n, directionOf } from './lib/i18n';
import { resolveLocale } from './lib/i18n';
import { getSession } from './lib/session.server';
import { sessionMiddleware } from './lib/session-middleware.server';
import stylesheet from './styles/app.css?url';

/**
 * Runs before every loader and action in the app, because root is a parent of
 * every route. Keeps the access token fresh and writes the rotated pair back
 * to the cookie — see `session-middleware.server.ts` for why it cannot live in
 * a loader. Stripped from the client bundle by the framework, along with
 * `loader` and `action`.
 */
export const middleware = [sessionMiddleware];

export const links: Route.LinksFunction = () => [
  { rel: 'manifest', href: '/manifest.webmanifest' },
  { rel: 'icon', href: '/icons/favicon.ico', sizes: '48x48' },
  { rel: 'icon', href: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
  // iOS ignores the manifest's icons and reads this instead. Without it an
  // installed app gets a screenshot of the page as its home-screen icon.
  { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },

  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    // Three scripts, only the weights used. Latin, Bengali and Arabic are all
    // requested up front so switching language does not flash unstyled text.
    rel: 'stylesheet',
    href:
      'https://fonts.googleapis.com/css2?' +
      'family=Inter:wght@400;500;600;700&' +
      'family=Noto+Sans+Bengali:wght@400;500;600;700&' +
      'family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap',
  },
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  return { locale: resolveLocale(request, session.get('locale')) };
}

/**
 * The document shell.
 *
 * Two rules govern this component, and breaking either one is a runtime crash:
 *
 *  1. **Never call `useLoaderData` here.** React Router renders `Layout` for
 *     the ErrorBoundary as well as the happy path, and in that case there is no
 *     data-router context — `useLoaderData` throws rather than returning
 *     undefined. `useRouteLoaderData('root')` is the supported way to read it,
 *     and returns `undefined` safely when the loader never ran.
 *
 *  2. **The i18n provider belongs here, not in the default export.** Wrapping
 *     `<Outlet />` alone would leave the ErrorBoundary outside the provider, so
 *     any translated string on an error screen would throw a second error on
 *     top of the first — the worst possible moment for it.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root');
  const locale = data?.locale ?? 'en';
  const dir = directionOf(locale);

  // Rebuilt only when the language changes; a new instance per render would
  // re-initialise i18next on every navigation.
  const i18n = useMemo(() => createI18n(locale), [locale]);

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        {/* `viewport-fit=cover` so the app reaches under the notch when
            installed; the safe-area padding in app.css puts the content back
            where it belongs. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

        {/* The browser chrome colour, per theme. Two tags with `media` rather
            than one value, or a dark-mode user gets an indigo bar above a
            near-black page. */}
        <meta name="theme-color" content="#4f46e5" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#1e1b4b" media="(prefers-color-scheme: dark)" />

        {/* iOS reads these rather than the manifest's `display` and `name`. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="TaskForge" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Applied before paint, so a dark-mode user never sees a white flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('taskforge-theme');" +
              "var d=window.matchMedia('(prefers-color-scheme: dark)').matches;" +
              "document.documentElement.dataset.theme=(t==='dark'||(t!=='light'&&d))?'dark':'light';}" +
              'catch(e){}})();',
          }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useServiceWorker();
  return <Outlet />;
}

/**
 * Registers the service worker, once, after the page is interactive.
 *
 * Deferred to `load` rather than run during hydration because registration
 * competes for bandwidth with the assets the page still needs, and the worker
 * is worth nothing on this visit — it takes effect on the next one.
 *
 * Registration is skipped in development. A service worker that caches build
 * output while Vite is rewriting build output produces the most confusing bug
 * in front-end work: changes that do not appear, intermittently, on one
 * machine.
 */
function useServiceWorker() {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Nothing to tell the user. Push and offline are unavailable; every
        // other part of the app works exactly as before.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
}

export function ErrorBoundary() {
  const error = useRouteError();

  // An auth failure that reaches here means a loader called the API without
  // going through requireUser first. Recover by refreshing rather than showing
  // the user a stack trace they can do nothing with.
  if (typeof document !== 'undefined' && isAuthError(error)) {
    const here = window.location.pathname + window.location.search;
    window.location.replace(`/refresh-session?next=${encodeURIComponent(here)}`);
    return null;
  }

  const { title, detail, unexpected } = describe(error);

  // Deliberately untranslated. This screen renders when something has already
  // gone wrong, and reaching for a translation here is one more thing that can
  // fail at the exact moment it must not.
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-page-x text-center">
      <h1 className="text-2xl">{title}</h1>

      <p className="text-md text-content-secondary">{detail}</p>

      {/* Only for the genuinely unexpected. A mistyped task key is an ordinary
          outcome, and forty lines of `callRouteMiddleware` under it says
          "the software broke" when the truthful message is "that does not
          exist". */}
      {import.meta.env.DEV && unexpected && error instanceof Error && (
        <pre className="max-w-full overflow-auto rounded-md bg-surface-sunken p-4 text-start text-xs">
          {error.stack}
        </pre>
      )}

      <a href="/" className="text-md font-medium">
        Go back
      </a>
    </main>
  );
}

/**
 * What to actually say.
 *
 * Everything used to read "Something went wrong / An unexpected error
 * occurred", including the two cases that are neither wrong nor unexpected:
 * asking for something that is not there, and asking for something that is not
 * yours. A 404 rendered as `404 — ` with nothing after the dash, because a
 * `new Response(null, { status: 404 })` carries no status text and nobody had
 * looked at the screen it produced.
 *
 * Note that "not found" and "not allowed" are described differently here but
 * are frequently the *same* response from the API, which answers 404 for
 * anything you may not see. That is deliberate on the server — a 403 confirms
 * a thing exists — and it means this screen will sometimes say "we couldn't
 * find that" about something real. That is the correct trade.
 */
function describe(error: unknown): { title: string; detail: string; unexpected: boolean } {
  const status = isRouteErrorResponse(error)
    ? error.status
    : (error as { status?: number } | null)?.status;

  if (status === 404) {
    return {
      title: 'Not found',
      detail:
        'This page, or the project or task it refers to, does not exist. ' +
        'The link may be out of date, or the item may have been deleted.',
      unexpected: false,
    };
  }

  if (status === 403) {
    return {
      title: 'You do not have access to this',
      detail: 'Ask a project manager on this project if you need it.',
      unexpected: false,
    };
  }

  return {
    title: 'Something went wrong',
    detail: isRouteErrorResponse(error)
      ? `${error.status}${error.statusText ? ` — ${error.statusText}` : ''}`
      : 'An unexpected error occurred.',
    unexpected: true,
  };
}

/**
 * An auth failure that reaches the error boundary means a loader called the API
 * without going through requireUser first. Recognising it lets us recover
 * instead of showing a stack trace the user can do nothing with.
 */
function isAuthError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED' || code === 'TOKEN_INVALID';
}
