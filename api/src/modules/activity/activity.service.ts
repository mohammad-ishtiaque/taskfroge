import type { Activity, ActivityKind, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../middleware/authenticate';

/* ==========================================================================
   Activity
   --------------------------------------------------------------------------
   Every state change writes one row here. Two decisions shape the whole file:

   1. **`detail` is values, not prose.** The row stores `{ taskKey, from, to }`
      and the kind; the client builds "Priya moved WEB-104 from In Progress to
      In Review" in the reader's language. A feed of English sentences cannot
      be translated afterwards, and this product ships in five languages.

   2. **Recording never breaks the operation that caused it.** If writing the
      activity row fails, the status change that just succeeded must still
      stand. A failed audit entry is a logged problem, not a rolled-back user
      action.
   ========================================================================== */

export interface RecordActivityInput {
  orgId: string;
  projectId: string;
  taskId?: string | null;
  actorId: string;
  kind: ActivityKind;
  detail: Record<string, string>;
  clientVisible?: boolean;
}

export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        actorId: input.actorId,
        kind: input.kind,
        detail: input.detail as Prisma.InputJsonValue,
        clientVisible: input.clientVisible ?? true,
      },
    });
  } catch (error) {
    // Deliberately swallowed. See the header: the caller's write already
    // succeeded and undoing it would be worse than a gap in the feed.
    logger.error({ err: error, kind: input.kind }, 'Failed to record activity');
  }
}

/**
 * The feed, scoped to the caller.
 *
 * A client sees only entries flagged visible — which excludes internal
 * comments, hidden tasks, and every visibility change. That last one matters:
 * "Priya hid a task from you" would be a strange thing to tell a client.
 */
export async function listActivity(
  auth: AuthContext,
  options: { projectId?: string; workspaceId?: string; limit?: number } = {},
): Promise<Activity[]> {
  const projectScope: Prisma.ProjectWhereInput =
    auth.role === 'PROJECT_MANAGER'
      ? { orgId: auth.orgId, archivedAt: null }
      : { orgId: auth.orgId, archivedAt: null, members: { some: { userId: auth.userId } } };

  if (options.workspaceId) projectScope.workspaceId = options.workspaceId;

  const where: Prisma.ActivityWhereInput = {
    orgId: auth.orgId,
    project: projectScope,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(auth.role === 'CLIENT'
      ? {
          clientVisible: true,
          // And the task must *still* be visible. The flag above is a snapshot
          // taken when the row was written; hiding a task afterwards does not
          // rewrite its history, and these rows embed the task title.
          OR: [{ taskId: null }, { task: { clientVisible: true } }],
        }
      : {}),
  };

  return prisma.activity.findMany({
    where,
    include: {
      actor: { select: { id: true, name: true, avatarUrl: true } },
      task: { select: { key: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 20, 100),
  });
}
