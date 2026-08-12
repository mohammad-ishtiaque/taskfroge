import type { Comment } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { personSelect, toComment, toComments } from '../../lib/serialize';
import type { AuthContext } from '../../middleware/authenticate';
import { getTaskByKey } from '../tasks/tasks.service';
import { recordActivity } from '../activity/activity.service';
import { notifyMany } from '../notifications/notifications.service';

/* ==========================================================================
   Comments
   --------------------------------------------------------------------------
   `isInternal` is the most consequential boolean in the product, and this file
   is where it is enforced. Three properties hold, and all three are tested:

   - A client's query never selects an internal comment. It is a WHERE clause,
     not a filter applied after loading.
   - A client cannot author one, whatever the request body says.
   - There is no setting, preset or toggle anywhere that relaxes either.
   ========================================================================== */

export async function listComments(auth: AuthContext, taskKey: string): Promise<Comment[]> {
  // Goes through getTaskByKey, so a client asking about a hidden task gets a
  // 404 before comments are ever considered.
  const task = await getTaskByKey(auth, taskKey);

  const rows = await prisma.comment.findMany({
    where: {
      taskId: task.id,
      deletedAt: null,
      // docs/04 §1. Not negotiable, not a setting.
      ...(auth.role === 'CLIENT' ? { isInternal: false } : {}),
    },
    include: { author: { select: personSelect(auth.orgId) } },
    orderBy: { createdAt: 'asc' },
  });

  return toComments(rows) as unknown as Comment[];
}

export async function addComment(
  auth: AuthContext,
  taskKey: string,
  input: { body: string; isInternal?: boolean },
): Promise<Comment> {
  const task = await getTaskByKey(auth, taskKey);

  // A client posting `isInternal: true` gets a normal comment, not an error.
  // Refusing would tell them the concept exists.
  const isInternal = auth.role === 'CLIENT' ? false : (input.isInternal ?? false);

  const comment = await prisma.comment.create({
    data: {
      orgId: auth.orgId,
      taskId: task.id,
      authorId: auth.userId,
      body: input.body,
      isInternal,
    },
    include: { author: { select: personSelect(auth.orgId) } },
  });

  await recordActivity({
    orgId: auth.orgId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: auth.userId,
    kind: 'COMMENTED',
    detail: { taskKey: task.key },
    // An internal comment must not surface in the client's feed as "someone
    // commented" either — the existence of the conversation is itself internal.
    clientVisible: !isInternal && task.clientVisible,
  });

  await notifyCommentAudience(auth, task, comment, isInternal);
  return toComment(comment) as unknown as Comment;
}

/**
 * Who hears about a comment.
 *
 * The assignee and the reporter, plus anyone already in the thread — the
 * people with a reason to care. And never a client when the comment is
 * internal, which is why the recipient list is filtered by role rather than
 * assembled and hoped over.
 */
async function notifyCommentAudience(
  auth: AuthContext,
  // `clientVisible` is carried because the notification layer needs it: a push
  // lands on a lock screen, and a client must not be told about a task they
  // have not been shown.
  task: {
    id: string;
    key: string;
    title: string;
    clientVisible: boolean;
    projectId: string;
    assigneeId: string | null;
    reporterId: string;
  },
  comment: Comment,
  isInternal: boolean,
): Promise<void> {
  const priorAuthors = await prisma.comment.findMany({
    where: { taskId: task.id, deletedAt: null },
    select: { authorId: true },
    distinct: ['authorId'],
  });

  const candidates = [
    task.assigneeId,
    task.reporterId,
    ...priorAuthors.map((c) => c.authorId),
  ].filter((id): id is string => Boolean(id));

  const recipients = await prisma.user.findMany({
    where: {
      id: { in: Array.from(new Set(candidates)) },
      isActive: true,
      memberships: { some: { orgId: auth.orgId, status: 'ACTIVE' } },
    },
    select: { id: true, memberships: { where: { orgId: auth.orgId }, select: { role: true } } },
  });

  const allowed = recipients
    .filter((u) => !(isInternal && u.memberships[0]?.role === 'CLIENT'))
    .map((u) => u.id);

  const project = await prisma.project.findUnique({
    where: { id: task.projectId },
    select: { key: true },
  });

  await notifyMany(allowed, {
    orgId: auth.orgId,
    actorId: auth.userId,
    kind: 'COMMENT',
    task,
    projectKey: project?.key ?? '',
  });

  void comment;
}

export async function deleteComment(auth: AuthContext, id: string): Promise<void> {
  const comment = await prisma.comment.findFirst({
    where: { id, orgId: auth.orgId, deletedAt: null },
  });

  if (!comment) throw AppError.notFound('Comment');

  // Your own, or a PM tidying up. Soft delete, so a thread that referenced it
  // still makes sense in the activity feed.
  if (comment.authorId !== auth.userId && auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('You can only delete your own comments');
  }

  await prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
}
