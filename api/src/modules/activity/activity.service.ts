import { logger } from '../../lib/logger';
import type { AuthContext } from '../../middleware/authenticate';
import {
  Activity,
  ActivityKind,
  Project,
  ProjectMember,
  Task,
  UserDocument,
  TaskDocument,
} from '../../models';

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
    await Activity.create({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      actorId: input.actorId,
      kind: input.kind,
      detail: input.detail,
      clientVisible: input.clientVisible ?? true,
    });
  } catch (error) {
    logger.error({ err: error, kind: input.kind }, 'Failed to record activity');
  }
}

export async function listActivity(
  auth: AuthContext,
  options: { projectId?: string; workspaceId?: string; limit?: number } = {},
): Promise<any[]> {
  let projectIds: string[];
  if (auth.role === 'PROJECT_MANAGER') {
    const projectQuery: any = { orgId: auth.orgId, archivedAt: null };
    if (options.workspaceId) projectQuery.workspaceId = options.workspaceId;
    const projects = await Project.find(projectQuery).select('id');
    projectIds = projects.map((p) => p.id);
  } else {
    const memberRecords = await ProjectMember.find({ userId: auth.userId }).select('projectId');
    const memberProjectIds = memberRecords.map((m) => m.projectId.toString());
    const projectQuery: any = { _id: { $in: memberProjectIds }, orgId: auth.orgId, archivedAt: null };
    if (options.workspaceId) projectQuery.workspaceId = options.workspaceId;
    const projects = await Project.find(projectQuery).select('id');
    projectIds = projects.map((p) => p.id);
  }

  const query: any = {
    orgId: auth.orgId,
    projectId: { $in: projectIds },
  };

  if (options.projectId) {
    query.projectId = options.projectId;
  }

  if (auth.role === 'CLIENT') {
    query.clientVisible = true;
    const hiddenTasks = await Task.find({ clientVisible: false }).select('id');
    const hiddenTaskIds = hiddenTasks.map((t) => t.id);
    if (hiddenTaskIds.length > 0) {
      query.taskId = { $nin: hiddenTaskIds };
    }
  }

  const limit = Math.min(options.limit ?? 20, 100);

  const activities = await Activity.find(query)
    .populate<{ actorId: UserDocument }>('actorId', 'id name avatarUrl')
    .populate<{ taskId: TaskDocument }>('taskId', 'key title')
    .sort({ createdAt: -1 })
    .limit(limit);

  return activities.map((a) => {
    const obj: any = a.toJSON();
    if (a.actorId) {
      obj.actor = { id: a.actorId.id, name: a.actorId.name, avatarUrl: a.actorId.avatarUrl };
    }
    if (a.taskId) {
      obj.task = { key: a.taskId.key, title: a.taskId.title };
    }
    delete obj.actorId;

    return obj;
  });
}
