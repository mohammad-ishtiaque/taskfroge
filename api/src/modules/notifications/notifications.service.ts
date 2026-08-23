import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import type { AuthContext } from '../../middleware/authenticate';
import { sendPush } from './push.service';
import {
  Notification,
  Membership,
  NotificationKind,
  UserDocument,
} from '../../models';

export interface NotifyInput {
  orgId: string;
  recipientId: string;
  actorId?: string | null;
  kind: NotificationKind;
  task: { id: string; key: string; title: string; clientVisible: boolean };
  projectKey: string;
}

const HEADLINE: Record<NotificationKind, string> = {
  ASSIGNED: 'Assigned to you',
  MENTIONED: 'You were mentioned',
  STATUS_CHANGED: 'Status changed',
  DUE_SOON: 'Due soon',
  OVERDUE: 'Overdue',
  COMMENT: 'New comment',
};

export async function notify(input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) return;

  try {
    await Notification.create({
      orgId: input.orgId,
      recipientId: input.recipientId,
      actorId: input.actorId ?? null,
      kind: input.kind,
      taskId: input.task.id,
      taskKey: input.task.key,
      taskTitle: input.task.title,
      projectKey: input.projectKey,
    });
  } catch (error) {
    logger.error({ err: error, kind: input.kind }, 'Failed to create notification');
    return;
  }

  await pushFor(input);
}

async function pushFor(input: NotifyInput): Promise<void> {
  const membership = await Membership.findOne({
    orgId: input.orgId,
    userId: input.recipientId,
  }).select('role');

  const isClient = membership?.role === 'CLIENT';

  if (isClient && !input.task.clientVisible) return;

  await sendPush(input.recipientId, {
    title: HEADLINE[input.kind],
    body: isClient ? input.task.key : `${input.task.key} · ${input.task.title}`,
    url: `/t/${input.task.key}`,
    tag: input.task.key,
  });
}

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
): Promise<any[]> {
  const query: any = {
    orgId: auth.orgId,
    recipientId: auth.userId,
  };

  if (options.unreadOnly) {
    query.readAt = null;
  }

  const limit = Math.min(options.limit ?? 50, 200);

  const notifications = await Notification.find(query)
    .populate<{ actorId: UserDocument }>('actorId', 'id name')
    .sort({ createdAt: -1 })
    .limit(limit);

  return notifications.map((n) => {
    const obj: any = n.toJSON();
    if (n.actorId) {
      obj.actor = { id: n.actorId.id, name: n.actorId.name };
    }
    delete obj.actorId;
    return obj;
  });
}

export async function unreadCount(auth: AuthContext): Promise<number> {
  return Notification.countDocuments({
    orgId: auth.orgId,
    recipientId: auth.userId,
    readAt: null,
  });
}

export async function markAllRead(auth: AuthContext): Promise<number> {
  const result = await Notification.updateMany(
    { orgId: auth.orgId, recipientId: auth.userId, readAt: null },
    { readAt: new Date() }
  );
  return result.modifiedCount;
}

export async function markRead(auth: AuthContext, id: string): Promise<void> {
  const result = await Notification.updateOne(
    { _id: id, orgId: auth.orgId, recipientId: auth.userId },
    { readAt: new Date() }
  );

  if (result.modifiedCount === 0) throw AppError.notFound('Notification');
}
