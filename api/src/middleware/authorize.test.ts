import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { authorize } from './authorize';
import { AppError } from '../lib/errors';

/**
 * The role gate.
 *
 * No database, no HTTP — just the decision. These are the rules M1 onwards
 * depends on, so they are worth pinning down before anything is built on them.
 */
function run(role: string | undefined, ...allowed: Parameters<typeof authorize>) {
  const req = (role ? { auth: { role } } : {}) as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;

  authorize(...allowed)(req, {} as Response, next);

  const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0];
  return { called: (next as unknown as { mock: { calls: unknown[][] } }).mock.calls.length, error };
}

describe('authorize', () => {
  it('lets a permitted role through with no error', () => {
    const { error } = run('PROJECT_MANAGER', 'PROJECT_MANAGER');
    expect(error).toBeUndefined();
  });

  it('accepts any one of several permitted roles', () => {
    expect(run('DEVELOPER', 'PROJECT_MANAGER', 'DEVELOPER').error).toBeUndefined();
    expect(run('PROJECT_MANAGER', 'PROJECT_MANAGER', 'DEVELOPER').error).toBeUndefined();
  });

  it('rejects a role that is not listed', () => {
    const { error } = run('DEVELOPER', 'PROJECT_MANAGER');
    expect(AppError.is(error)).toBe(true);
    expect((error as AppError).status).toBe(403);
    expect((error as AppError).code).toBe('FORBIDDEN');
  });

  it('never lets a client through a project-manager gate', () => {
    // The rule with the highest cost of being wrong: a client must not reach
    // anything that manages a project.
    const { error } = run('CLIENT', 'PROJECT_MANAGER');
    expect((error as AppError).status).toBe(403);
  });

  it('rejects a developer from a project-manager gate', () => {
    expect((run('DEVELOPER', 'PROJECT_MANAGER').error as AppError).status).toBe(403);
  });

  it('fails as a server error, not a 403, when authenticate did not run first', () => {
    // A missing auth context is a wiring mistake in our code, not a permission
    // decision. Reporting it as 403 would send someone hunting for a role bug.
    const { error } = run(undefined, 'PROJECT_MANAGER');
    expect((error as AppError).status).toBe(500);
  });

  it('names the required roles in the message, so the 403 is actionable', () => {
    const { error } = run('CLIENT', 'PROJECT_MANAGER', 'DEVELOPER');
    expect((error as AppError).message).toContain('PROJECT_MANAGER');
    expect((error as AppError).message).toContain('DEVELOPER');
  });

  it('denies everything when the allow-list is empty', () => {
    // Fail closed. An accidentally empty list must lock the door, not open it.
    for (const role of ['PROJECT_MANAGER', 'DEVELOPER', 'CLIENT']) {
      expect((run(role).error as AppError).status).toBe(403);
    }
  });
});
