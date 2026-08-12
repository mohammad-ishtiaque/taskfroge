/**
 * The page the service worker shows when a navigation fails.
 *
 * Deliberately untranslated and free of loaders. It is cached at install time
 * and served with no network, so anything it depends on — a translation
 * bundle, a session, the API — is exactly what is unavailable when it renders.
 */
export function meta() {
  return [{ title: 'Offline · TaskForge' }];
}

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-page-x text-center">
      <img src="/icons/icon-192.png" alt="" width={64} height={64} className="rounded-2xl" />

      <h1 className="text-2xl">You are offline</h1>

      <p className="text-md text-content-secondary">
        TaskForge needs a connection to show your projects. Everything you had
        open is still on the server.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border border-stroke-subtle px-4 py-2.5 text-md font-medium"
      >
        Try again
      </button>
    </main>
  );
}
