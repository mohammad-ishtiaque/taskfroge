/* ==========================================================================
   TaskForge service worker
   --------------------------------------------------------------------------
   Two jobs: keep the app usable when the network is not, and receive pushes.

   **Why this is hand-written and not Workbox.** The usual precache-manifest
   approach wants a build step that knows every hashed asset. This app is
   server-rendered — the HTML is generated per request, per user, per role —
   so precaching documents is not just unhelpful, it is dangerous: a cached
   dashboard is a cached dashboard belonging to *somebody*, and the next person
   to sign in on that device must not see it. So nothing that could contain
   another person's data is stored.

   What is cached:
     · hashed build assets (/assets/*)      — immutable, safe, and the bulk of
                                               the bytes
     · icons and the manifest                — small, static, no user in them
     · one offline page                      — shown when a navigation fails

   What is never cached:
     · any document response                 — they contain the signed-in
                                               user's data
     · anything under /api or a data request — same reason, and stale project
                                               data is worse than no data
   ========================================================================== */

const VERSION = 'v1';
const ASSETS = `taskforge-assets-${VERSION}`;
const SHELL = `taskforge-shell-${VERSION}`;

const OFFLINE_URL = '/offline';

/** Static, user-free, and worth having before the network disappears. */
const SHELL_URLS = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // `reload` so an install triggered by a new deploy does not populate the
      // new cache from the old one via the HTTP cache.
      .then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      // A failed shell fetch must not fail the install — the worker is still
      // useful for pushes, and the offline page is a nicety.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('taskforge-') && key !== ASSETS && key !== SHELL)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET. A POST that succeeded from cache would be a lie about work the
  // server has not done.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin — fonts, anything else. Left to the browser.
  if (url.origin !== self.location.origin) return;

  // Data requests carry the signed-in user's data and must never be served
  // stale. React Router marks them with `.data`; `/api` is belt and braces.
  if (url.pathname.startsWith('/api') || url.pathname.endsWith('.data')) return;

  // Hashed build output. The filename changes when the content does, so this
  // can be cache-first without ever going stale.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  // Everything else is a document. Network only, with the offline page as the
  // fallback — never a cached page, which would be somebody's dashboard.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? offlineResponse())),
    );
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/** If even the offline page is missing, say so rather than showing nothing. */
function offlineResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
      '<p style="font-family:system-ui;padding:2rem">You are offline.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/* ── Push ────────────────────────────────────────────────────────────────
   The payload is built by the API and is deliberately thin: a title, a line of
   body, and a URL. Notably it does *not* contain a task title when the
   recipient is a client who may not see that task — that decision is made on
   the server, in the same place every other visibility decision is made, and
   this worker does no filtering of its own. A lock screen is the last place to
   discover that a rule was only enforced in the UI. */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'TaskForge';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Same tag replaces rather than stacks, so ten status changes on one task
      // are one notification rather than ten.
      tag: payload.tag || 'taskforge',
      renotify: Boolean(payload.tag),
      data: { url: payload.url || '/' },
      timestamp: Date.now(),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  // Focus an open tab if there is one, rather than opening a second copy of an
  // app the person already has in front of them.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

/* A subscription can be rotated by the browser without the user doing
   anything. Without this the endpoint on the server goes dead and pushes stop
   arriving, silently, which is the worst failure mode a notification system
   has. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true })
      .then((subscription) =>
        fetch('/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        }),
      )
      .catch(() => undefined),
  );
});
