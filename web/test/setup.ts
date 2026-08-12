import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll } from 'vitest';

/**
 * Secrets the server modules refuse to load without.
 *
 * `session.server.ts` throws at import time if `SESSION_SECRET` is missing —
 * deliberately, because a session cookie signed with nothing is not signed.
 * That check runs when a route module is imported, so it has to be satisfied
 * before any test file loads one.
 */
beforeAll(() => {
  process.env.SESSION_SECRET ??= 'test-only-session-secret-at-least-32-chars';
  process.env.API_URL ??= 'http://api.test/api/v1';
});

// React Testing Library leaves the DOM in place between tests otherwise, and
// the second `getByRole` then finds two of everything.
afterEach(() => cleanup());
