import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/* ==========================================================================
   Web tests
   --------------------------------------------------------------------------
   The API had 131 tests and this side had a shell script. Every user-interface
   bug in the last two days was found by a person clicking:

     · a developer opening any task got a stack trace, because the loader
       called a managers-only endpoint
     · the analytics screen printed NaN down the page, because `groupBy`
       returns only the rows that exist
     · the Settings tab was offered to developers and answered 404
     · the filter pills had a full centimetre of air on one side

   Not one of those is exotic. Every one is a function called with a role, or a
   value, that nobody had tried. That is what this catches.

   **What is deliberately not here.** No browser, no dev server, no snapshots.
   The React Router loaders and actions are plain async functions that take a
   Request and return data — they can be called directly, which is faster and
   far more honest than driving a headless Chrome around. Components that hold
   real logic get rendered; components that are markup do not.
   ========================================================================== */

export default defineConfig({
  // `~` resolved by hand rather than through `vite-tsconfig-paths`. Vitest
  // bundles its own copy of Vite, so a plugin built against the app's copy is
  // a different `Plugin` type and the config stops typechecking. One alias is
  // cheaper than the version dance.
  resolve: {
    alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // Route modules import `.server` files, which import `process.env`. The
    // node condition keeps those resolving the way they do at runtime.
    server: { deps: { inline: [/^~\//] } },
    include: ['app/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
