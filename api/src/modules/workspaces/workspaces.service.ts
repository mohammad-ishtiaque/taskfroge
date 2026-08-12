import type { Prisma, Workspace } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../middleware/authenticate';

/* ==========================================================================
   Workspaces — one per client
   --------------------------------------------------------------------------
   The strongest isolation boundary in the product, and it is structural: a
   client's reachable workspaces are derived from their project memberships, so
   there is no query that could return another client's work by omission.
   ========================================================================== */

function scope(auth: AuthContext): Prisma.WorkspaceWhereInput {
  if (auth.role !== 'CLIENT') return { orgId: auth.orgId, archivedAt: null };

  return {
    orgId: auth.orgId,
    archivedAt: null,
    projects: { some: { members: { some: { userId: auth.userId } } } },
  };
}

export async function listWorkspaces(auth: AuthContext): Promise<Workspace[]> {
  return prisma.workspace.findMany({
    where: scope(auth),
    include: { _count: { select: { projects: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function getWorkspaceBySlug(auth: AuthContext, slug: string): Promise<Workspace> {
  const workspace = await prisma.workspace.findFirst({
    where: { ...scope(auth), slug },
    include: { _count: { select: { projects: true } } },
  });

  // 404, not 403 — a client guessing another client's slug learns nothing.
  if (!workspace) throw AppError.notFound('Workspace');
  return workspace;
}

export async function createWorkspace(
  auth: AuthContext,
  input: { name: string; clientName: string },
): Promise<Workspace> {
  if (auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('Only a project manager can create a workspace');
  }

  const slug = await uniqueSlug(auth.orgId, input.name);

  const workspace = await prisma.workspace.create({
    data: { orgId: auth.orgId, slug, name: input.name, clientName: input.clientName },
  });

  logger.info({ workspaceId: workspace.id, slug, by: auth.userId }, 'Workspace created');
  return workspace;
}

export async function updateWorkspace(
  auth: AuthContext,
  slug: string,
  input: { name?: string; clientName?: string },
): Promise<Workspace> {
  if (auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('Only a project manager can change a workspace');
  }

  const workspace = await getWorkspaceBySlug(auth, slug);

  // The slug is deliberately not updatable. Renaming a workspace must not
  // break links people have already saved or emailed.
  return prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.clientName !== undefined && { clientName: input.clientName }),
    },
  });
}

/**
 * A URL-safe slug, made unique within the organisation.
 *
 * Suffixes rather than rejects on collision: two clients genuinely can be
 * called "Acme", and refusing the second would be a strange thing to explain.
 */
async function uniqueSlug(orgId: string, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';

  const taken = await prisma.workspace.findMany({
    where: { orgId, slug: { startsWith: base } },
    select: { slug: true },
  });

  const used = new Set(taken.map((w) => w.slug));
  if (!used.has(base)) return base;

  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }

  throw AppError.conflict('Could not derive a unique workspace address');
}
