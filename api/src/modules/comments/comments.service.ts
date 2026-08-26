import { AppError } from '../../lib/errors';
import { toComment, toComments } from '../../lib/serialize';
import type { AuthContext } from '../../middleware/authenticate';
import { getTaskByKey } from '../tasks/tasks.service';
import { recordActivity } from '../activity/activity.service';
import { notifyMany } from '../notifications/notifications.service';
import { Comment, User, Membership, Project, UserDocument } from '../../models';

export interface CommentDto {
  id: string;
  orgId: string;
  taskId: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  author?: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    role?: string;
    initials?: string;
    avatarColor?: string;
  } | null;
}

export async function listComments(auth: AuthContext, taskKey: string): Promise<Record<string, unknown>[]> {
  const task = await getTaskByKey(auth, taskKey);

  const query: Record<string, unknown> = {
    taskId: task.id,
    deletedAt: null,
  };

  if (auth.role === 'CLIENT') {
    query.isInternal = false;
  }

  const comments = await Comment.find(query)
    .populate<{ authorId: UserDocument }>('authorId')
    .sort({ createdAt: 1 });

  const populated = await Promise.all(
    comments.map(async (c: any) => {
      const obj = (typeof c.toJSON === 'function' ? c.toJSON() : c) as Record<string, any>;
      const author = c.authorId as UserDocument | undefined | null;
      if (author && author._id) {
        const authorIdStr = String(author._id ?? author.id);
        const membership = await Membership.findOne({ orgId: auth.orgId, userId: authorIdStr }).select('role');
        obj.author = {
          id: authorIdStr,
          name: author.name,
          email: author.email,
          avatarUrl: author.avatarUrl,
          memberships: membership ? [{ role: membership.role }] : [],
        };
      }
      delete obj.authorId;
      return obj;
    })
  );

  return toComments(populated);
}

export async function addComment(
  auth: AuthContext,
  taskKey: string,
  input: { body: string; isInternal?: boolean },
): Promise<Record<string, unknown>> {
  const task = await getTaskByKey(auth, taskKey);

  const isInternal = auth.role === 'CLIENT' ? false : (input.isInternal ?? false);

  const commentDoc = await Comment.create({
    orgId: auth.orgId,
    taskId: task.id,
    authorId: auth.userId,
    body: input.body,
    isInternal,
  });

  await recordActivity({
    orgId: auth.orgId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: auth.userId,
    kind: 'COMMENTED',
    detail: { taskKey: task.key },
    clientVisible: !isInternal && task.clientVisible,
  });

  const commentObj = commentDoc.toJSON() as Record<string, any>;
  const authorUser = await User.findById(auth.userId);
  if (authorUser) {
    const membership = await Membership.findOne({ orgId: auth.orgId, userId: auth.userId }).select('role');
    commentObj.author = {
      id: authorUser.id,
      name: authorUser.name,
      email: authorUser.email,
      avatarUrl: authorUser.avatarUrl,
      memberships: membership ? [{ role: membership.role }] : [],
    };
  }

  await notifyCommentAudience(auth, task, commentObj, isInternal);
  return toComment(commentObj);
}

async function notifyCommentAudience(
  auth: AuthContext,
  task: {
    id: string;
    key: string;
    title: string;
    clientVisible: boolean;
    projectId: string;
    assigneeId?: string | null;
    assignee?: { id: string } | null;
    reporterId?: string;
    reporter?: { id: string } | null;
  },
  comment: Record<string, unknown>,
  isInternal: boolean,
): Promise<void> {
  const priorAuthors = await Comment.distinct('authorId', { taskId: task.id, deletedAt: null });

  const assigneeId = task.assignee?.id ?? task.assigneeId;
  const reporterId = task.reporter?.id ?? task.reporterId;

  const candidates = [
    assigneeId,
    reporterId,
    ...priorAuthors.map((a: unknown) => String(a)),
  ].filter((id): id is string => Boolean(id));

  const uniqueCandidates = Array.from(new Set(candidates));

  const activeMemberships = await Membership.find({
    orgId: auth.orgId,
    userId: { $in: uniqueCandidates },
    status: 'ACTIVE',
  });

  const activeUserIds = activeMemberships.map((m: { userId: any }) => String(m.userId));
  const users = await User.find({ _id: { $in: activeUserIds }, isActive: true });

  const allowed = users
    .filter((u: { _id?: any; id?: string }) => {
      const uId = String(u._id ?? u.id);
      const mem = activeMemberships.find((m: { userId: any; role: string }) => String(m.userId) === uId);
      return !(isInternal && mem?.role === 'CLIENT');
    })
    .map((u: { _id?: any; id?: string }) => String(u._id ?? u.id));

  const project = await Project.findById(task.projectId).select('key');

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
  const comment = await Comment.findOne({ _id: id, orgId: auth.orgId, deletedAt: null });

  if (!comment) throw AppError.notFound('Comment');

  if (comment.authorId.toString() !== auth.userId && auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('You can only delete your own comments');
  }

  await Comment.findByIdAndUpdate(id, { deletedAt: new Date() });
}
