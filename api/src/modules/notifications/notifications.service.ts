import type { Notification, NotificationKind, Task } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import type { AuthContext } from '../../middleware/authenticate';
import { sendPush } from './push.service';

/* ==========================================================================
   Notifications
   --------------------------------------------------------------------------
   Task key and title are copied onto the row rather than joined. Two reasons:
   a notification about a since-archived task must still read correctly, and
   the unread badge loads on every single page — a join there is a join on
   every navigation.
   ========================================================================== */

export interface NotifyInput {
  orgId: string;
  recipientId: string;
  actorId?: string | null;
  kind: NotificationKind;
  task: Pick<Task, 'id' | 'key' | 'title' | 'clientVisible'>;
  projectKey: string;
}

/** What each kind actually says, in the one sentence a lock screen has room for. */
const HEADLINE: Record<NotificationKind, string> = {
  ASSIGNED: 'Assigned to you',
  MENTIONED: 'You were mentioned',
  STATUS_CHANGED: 'Status changed',
  DUE_SOON: 'Due soon',
  OVERDUE: 'Overdue',
  COMMENT: 'New comment',
};

export async function notify(input: NotifyInput): Promise<void> {
  // Nobody needs telling about their own action. Without this the person who
  // moves a task gets a notification that they moved a task.
  if (input.actorId && input.actorId === input.recipientId) return;

  try {
    await prisma.notification.create({
      data: {
        orgId: input.orgId,
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        kind: input.kind,
        taskId: input.task.id,
        taskKey: input.task.key,
        taskTitle: input.task.title,
        projectKey: input.projectKey,
      },
    });
  } catch (error) {
    // Same reasoning as activity: the operation that triggered this already
    // succeeded, and failing it now would be the worse outcome.
    logger.error({ err: error, kind: input.kind }, 'Failed to create notification');
    return;
  }

  // The push is a nudge towards the row, not a replacement for it, which is why
  // it happens after and why a failure here is swallowed by `sendPush`.
  await pushFor(input);
}

/**
 * Builds the push payload, and decides how much of it a lock screen may hold.
 *
 * The rule that matters: a client never gets a task title. Not because their
 * notification is necessarily about a hidden task — usually it is not — but
 * because whether it is hidden can change after this row was written, this
 * payload is read without signing in, and it is read by whoever is holding the
 * phone. Every other visibility decision in this codebase is made in a WHERE
 * clause on the server; this one is made here, for the same reason.
 *
 * A client therefore gets "New comment · WEB-14" and taps through to a screen
 * that re-checks everything. A manager or developer gets the title, because
 * they are entitled to it and a notification without it is close to useless.
 */
async function pushFor(input: NotifyInput): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId: input.orgId, userId: input.recipientId } },
    select: { role: true },
  });

  const isClient = membership?.role === 'CLIENT';

  // Belt and braces: a client is not sent a push about a task that is hidden
  // from them at all, title or no title. The task key alone would still tell
  // them work exists that they have not been shown.
  if (isClient && !input.task.clientVisible) return;

  await sendPush(input.recipientId, {
    title: HEADLINE[input.kind],
    body: isClient ? input.task.key : `${input.task.key} · ${input.task.title}`,
    // `/t/:key` rather than the full workspace path. This function does not
    // know the workspace slug, and looking it up would be a query per push for
    // a value the web tier can resolve for free on the way in.
    url: `/t/${input.task.key}`,
    // One notification per task rather than a stack of ten.
    tag: input.task.key,
  });
}

/** Fan-out to several people at once, de-duplicated. */
export async function notifyMany(
  recipients: string[],
  input: Omit<NotifyInput, 'recipientId'>,
): Promise<void> {
  const unique = Array.from(new Set(recipients)).filter((id) => id !== input.actorId);
  await Promise.all(unique.map((recipientId) => notify({ ...input, recipientId })));
}

export async function listNotifications(
  auth: AuthContext,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: {
      orgId: auth.orgId,
      recipientId: auth.userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 50, 200),
  });
}

export async function unreadCount(auth: AuthContext): Promise<number> {
  return prisma.notification.count({
    where: { orgId: auth.orgId, recipientId: auth.userId, readAt: null },
  });
}

export async function markAllRead(auth: AuthContext): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { orgId: auth.orgId, recipientId: auth.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function markRead(auth: AuthContext, id: string): Promise<void> {
  // Scoped by recipient, so one person cannot mark another's notification
  // read by guessing an id.
  const result = await prisma.notification.updateMany({
    where: { id, orgId: auth.orgId, recipientId: auth.userId },
    data: { readAt: new Date() },
  });

  if (result.count === 0) throw AppError.notFound('Notification');
}
