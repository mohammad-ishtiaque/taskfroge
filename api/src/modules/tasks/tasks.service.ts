import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { withTransaction } from '../../lib/db';
import type { AuthContext } from '../../middleware/authenticate';
import { toTask, toTasks } from '../../lib/serialize';
import { recordActivity } from '../activity/activity.service';
import { notify } from '../notifications/notifications.service';
import {
  Task,
  Project,
  ProjectMember,
  Membership,
  ProjectVisibility,
  UserDocument,
  TaskStatus,
  TaskType,
  Priority,
} from '../../models';

async function getReachableProjectIds(auth: AuthContext): Promise<string[]> {
  if (auth.role === 'PROJECT_MANAGER') {
    const projects = await Project.find({ orgId: auth.orgId, archivedAt: null }).select('id');
    return projects.map((p) => p.id);
  }

  const memberRecords = await ProjectMember.find({ userId: auth.userId }).select('projectId');
  const projectIds = memberRecords.map((m) => m.projectId.toString());

  const projects = await Project.find({
    _id: { $in: projectIds },
    orgId: auth.orgId,
    archivedAt: null,
  }).select('id');

  return projects.map((p) => p.id);
}

async function taskScopeQuery(auth: AuthContext): Promise<any> {
  const projectIds = await getReachableProjectIds(auth);
  const base: any = {
    orgId: auth.orgId,
    archivedAt: null,
    projectId: { $in: projectIds },
  };

  if (auth.role === 'CLIENT') base.clientVisible = true;
  return base;
}

export async function requireProject(auth: AuthContext, key: string) {
  const projectIds = await getReachableProjectIds(auth);
  const project = await Project.findOne({
    _id: { $in: projectIds },
    key: key.toUpperCase(),
  });

  if (!project) throw AppError.notFound('Project');

  const visibility = await ProjectVisibility.findOne({ projectId: project.id });
  return {
    ...project.toJSON(),
    visibility: visibility ? visibility.toJSON() : null,
  };
}

export interface ListTaskFilters {
  status?: TaskStatus;
  type?: TaskType;
  priority?: Priority;
  assigneeId?: string;
  search?: string;
  includeSubtasks?: boolean;
}

export async function listTasks(
  auth: AuthContext,
  projectId: string,
  filters: ListTaskFilters = {},
): Promise<any[]> {
  const baseQuery = await taskScopeQuery(auth);
  const query: any = {
    ...baseQuery,
    projectId,
  };

  if (!filters.includeSubtasks) query.parentId = null;
  if (filters.status) query.status = filters.status;
  if (filters.type) query.type = filters.type;
  if (filters.priority) query.priority = filters.priority;

  if (filters.assigneeId) {
    query.assigneeId = filters.assigneeId === 'UNASSIGNED' ? null : filters.assigneeId;
  }

  if (filters.search) {
    const searchRegex = new RegExp(filters.search, 'i');
    query.$or = [{ title: searchRegex }, { key: filters.search.toUpperCase() }];
  }

  const tasks = await Task.find(query)
    .populate<{ assigneeId: UserDocument }>('assigneeId')
    .populate<{ reporterId: UserDocument }>('reporterId')
    .sort({ status: 1, priority: 1, dueDate: 1 });

  const populated = await Promise.all(
    tasks.map(async (t) => {
      const obj: any = t.toJSON();
      obj.assignee = t.assigneeId ? await hydratePerson(t.assigneeId, auth.orgId) : null;
      obj.reporter = t.reporterId ? await hydratePerson(t.reporterId, auth.orgId) : null;
      delete obj.assigneeId;
      delete obj.reporterId;
      return obj;
    })
  );

  return toTasks(populated);
}

async function hydratePerson(userDoc: any, orgId: string) {
  const membership = await Membership.findOne({ orgId, userId: userDoc.id }).select('role');
  return {
    id: userDoc.id,
    name: userDoc.name,
    email: userDoc.email,
    avatarUrl: userDoc.avatarUrl,
    memberships: membership ? [{ role: membership.role }] : [],
  };
}

export async function getTaskByKey(auth: AuthContext, key: string): Promise<any> {
  const baseQuery = await taskScopeQuery(auth);
  const query = {
    ...baseQuery,
    key: key.toUpperCase(),
  };

  const task = await Task.findOne(query)
    .populate<{ assigneeId: UserDocument }>('assigneeId')
    .populate<{ reporterId: UserDocument }>('reporterId');

  if (!task) throw AppError.notFound('Task');

  const taskObj: any = task.toJSON();
  taskObj.assignee = task.assigneeId ? await hydratePerson(task.assigneeId, auth.orgId) : null;
  taskObj.reporter = task.reporterId ? await hydratePerson(task.reporterId, auth.orgId) : null;

  const projectDoc = await Project.findById(task.projectId);
  if (projectDoc) {
    const [visibility, members, pTasks] = await Promise.all([
      ProjectVisibility.findOne({ projectId: projectDoc.id }),
      ProjectMember.find({ projectId: projectDoc.id }).select('userId'),
      Task.find({ projectId: projectDoc.id, archivedAt: null }).select('status parentId'),
    ]);
    taskObj.project = {
      ...projectDoc.toJSON(),
      visibility: visibility ? visibility.toJSON() : null,
      members: members.map((m) => ({ userId: m.userId.toString() })),
      tasks: pTasks.map((t) => t.toJSON()),
    };
  }

  const subtaskDocs = await Task.find({ parentId: task.id, archivedAt: null }).populate<{ assigneeId: UserDocument }>('assigneeId');
  taskObj.subtasks = await Promise.all(
    subtaskDocs.map(async (st) => {
      const stObj: any = st.toJSON();
      stObj.assignee = st.assigneeId ? await hydratePerson(st.assigneeId, auth.orgId) : null;
      delete stObj.assigneeId;
      return stObj;
    })
  );

  return toTask(taskObj);
}

export async function listSubtasks(auth: AuthContext, parentId: string): Promise<any[]> {
  const baseQuery = await taskScopeQuery(auth);
  const tasks = await Task.find({ ...baseQuery, parentId })
    .populate<{ assigneeId: UserDocument }>('assigneeId')
    .sort({ createdAt: 1 });

  return Promise.all(
    tasks.map(async (t) => {
      const obj: any = t.toJSON();
      obj.assignee = t.assigneeId ? await hydratePerson(t.assigneeId, auth.orgId) : null;
      delete obj.assigneeId;
      return obj;
    })
  );
}

export async function listMyTasks(auth: AuthContext, workspaceId?: string): Promise<any[]> {
  const baseQuery = await taskScopeQuery(auth);
  const query: any = {
    ...baseQuery,
    assigneeId: auth.userId,
    status: { $ne: 'DONE' },
  };

  if (workspaceId) {
    const projects = await Project.find({ workspaceId, orgId: auth.orgId, archivedAt: null }).select('id');
    query.projectId = { $in: projects.map((p) => p.id) };
  }

  const tasks = await Task.find(query)
    .populate<{ projectId: any }>('projectId', 'key name')
    .sort({ dueDate: 1 });

  return tasks.map((t) => {
    const obj: any = t.toJSON();
    obj.project = t.projectId ? { key: t.projectId.key, name: t.projectId.name } : null;
    return obj;
  });
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: 'TASK' | 'BUG' | 'STORY' | 'CHORE';
  priority?: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  assigneeId?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  parentId?: string | null;
}

export async function createTask(
  auth: AuthContext,
  projectKey: string,
  input: CreateTaskInput,
): Promise<any> {
  const project = await requireProject(auth, projectKey);

  if (auth.role === 'CLIENT' && input.assigneeId) {
    throw AppError.forbidden('Clients cannot assign tasks');
  }

  if (input.assigneeId) await assertProjectMember(project.id, input.assigneeId);

  if (input.parentId) {
    const parentQuery = await taskScopeQuery(auth);
    const parent = await Task.findOne({ ...parentQuery, _id: input.parentId });
    if (!parent) throw AppError.notFound('Parent task');

    if (parent.parentId) throw AppError.validation('A subtask cannot have subtasks');
    if (parent.projectId.toString() !== project.id) {
      throw AppError.validation('A subtask must be in the same project as its parent');
    }
  }

  const taskDoc = await withTransaction(async (session) => {
    const lastTask = await Task.findOne({ projectId: project.id }).sort({ number: -1 }).select('number');
    const number = (lastTask?.number ?? 0) + 1;

    const [created] = await Task.create(
      [
        {
          orgId: auth.orgId,
          projectId: project.id,
          parentId: input.parentId ?? null,
          number,
          key: `${project.key}-${number}`,
          title: input.title,
          description: input.description ?? null,
          type: input.type ?? 'TASK',
          priority: input.priority ?? 'MEDIUM',
          assigneeId: input.assigneeId ?? null,
          reporterId: auth.userId,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          estimateHours: input.estimateHours ?? null,
          clientVisible: project.visibility?.preset !== 'SUMMARY',
        },
      ],
      { session }
    );

    return created;
  });

  if (!taskDoc) throw AppError.internal('Failed to create task');

  await recordActivity({
    orgId: auth.orgId,
    projectId: project.id,
    taskId: taskDoc.id,
    actorId: auth.userId,
    kind: 'TASK_CREATED',
    detail: { taskKey: taskDoc.key },
    clientVisible: taskDoc.clientVisible,
  });

  if (taskDoc.assigneeId && taskDoc.assigneeId.toString() !== auth.userId) {
    await notify({
      orgId: auth.orgId,
      recipientId: taskDoc.assigneeId.toString(),
      actorId: auth.userId,
      kind: 'ASSIGNED',
      task: taskDoc.toJSON(),
      projectKey: project.key,
    });
  }

  logger.info({ taskKey: taskDoc.key, by: auth.userId }, 'Task created');
  return getTaskByKey(auth, taskDoc.key);
}

const PM_ONLY_TRANSITIONS: readonly TaskStatus[] = ['DONE'];

export interface UpdateStatusInput {
  status: TaskStatus;
  blockedReason?: string;
}

export async function updateTaskStatus(
  auth: AuthContext,
  taskKey: string,
  input: UpdateStatusInput,
): Promise<any> {
  const task = await getTaskByKey(auth, taskKey);

  if (auth.role === 'CLIENT') throw AppError.forbidden('Clients cannot change task status');

  const assigneeIdStr = task.assignee?.id ?? task.assigneeId;
  if (auth.role === 'DEVELOPER' && assigneeIdStr !== auth.userId) {
    throw AppError.forbidden('You can only change the status of tasks assigned to you');
  }

  if (PM_ONLY_TRANSITIONS.includes(input.status) && auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('Only a project manager can mark a task done', {
      code: 'PM_APPROVAL_REQUIRED',
    });
  }

  if (input.status === 'BLOCKED' && !input.blockedReason?.trim()) {
    throw AppError.validation('Say what is blocking it', {
      issues: { blockedReason: ['A reason is required when blocking a task'] },
    });
  }

  if (input.status === 'DONE') {
    const open = await Task.countDocuments({
      parentId: task.id,
      archivedAt: null,
      status: { $ne: 'DONE' },
    });
    if (open > 0) {
      throw AppError.conflict('Finish the subtasks before closing this task', {
        code: 'SUBTASKS_OPEN',
        openSubtasks: open,
      });
    }
  }

  if (task.status === input.status) return task;

  await Task.findByIdAndUpdate(
    task.id,
    {
      status: input.status,
      blockedReason: input.status === 'BLOCKED' ? (input.blockedReason ?? null) : null,
      reminderSentAt: null,
      overdueNotified: false,
    },
    { new: true }
  );

  await recordActivity({
    orgId: auth.orgId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: auth.userId,
    kind: input.status === 'BLOCKED' ? 'BLOCKED' : task.status === 'BLOCKED' ? 'UNBLOCKED' : 'STATUS_CHANGED',
    detail: { taskKey: task.key, from: task.status, to: input.status },
    clientVisible: task.clientVisible,
  });

  const updatedTask = await getTaskByKey(auth, taskKey);

  const newAssigneeId = updatedTask.assignee?.id ?? updatedTask.assigneeId;
  if (newAssigneeId && newAssigneeId !== auth.userId) {
    await notify({
      orgId: auth.orgId,
      recipientId: newAssigneeId,
      actorId: auth.userId,
      kind: 'STATUS_CHANGED',
      task: updatedTask,
      projectKey: taskKey.split('-')[0]!,
    });
  }

  return updatedTask;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  type?: 'TASK' | 'BUG' | 'STORY' | 'CHORE';
  priority?: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  assigneeId?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  loggedHours?: number;
  clientVisible?: boolean;
}

export async function updateTask(
  auth: AuthContext,
  taskKey: string,
  input: UpdateTaskInput,
): Promise<any> {
  const task = await getTaskByKey(auth, taskKey);

  if (auth.role === 'CLIENT') throw AppError.forbidden('Clients cannot edit tasks');

  const assigneeIdStr = task.assignee?.id ?? task.assigneeId;
  if (auth.role === 'DEVELOPER') {
    if (assigneeIdStr !== auth.userId) {
      throw AppError.forbidden('You can only edit tasks assigned to you');
    }
    const restricted = ['assigneeId', 'dueDate', 'clientVisible'] as const;
    for (const field of restricted) {
      if (input[field] !== undefined) {
        throw AppError.forbidden(`Only a project manager can change ${field}`);
      }
    }
  }

  if (input.assigneeId) await assertProjectMember(task.projectId, input.assigneeId);

  const updateData: any = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.assigneeId !== undefined) updateData.assigneeId = input.assigneeId;
  if (input.dueDate !== undefined) {
    updateData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    updateData.reminderSentAt = null;
    updateData.overdueNotified = false;
  }
  if (input.estimateHours !== undefined) updateData.estimateHours = input.estimateHours;
  if (input.loggedHours !== undefined) updateData.loggedHours = input.loggedHours;
  if (input.clientVisible !== undefined) updateData.clientVisible = input.clientVisible;

  await Task.findByIdAndUpdate(task.id, updateData);

  const updatedTask = await getTaskByKey(auth, taskKey);

  if (input.assigneeId !== undefined && input.assigneeId !== assigneeIdStr) {
    await recordActivity({
      orgId: auth.orgId,
      projectId: task.projectId,
      taskId: task.id,
      actorId: auth.userId,
      kind: 'ASSIGNED',
      detail: { taskKey: task.key },
      clientVisible: updatedTask.clientVisible,
    });

    if (input.assigneeId && input.assigneeId !== auth.userId) {
      await notify({
        orgId: auth.orgId,
        recipientId: input.assigneeId,
        actorId: auth.userId,
        kind: 'ASSIGNED',
        task: updatedTask,
        projectKey: taskKey.split('-')[0]!,
      });
    }
  }

  if (input.clientVisible !== undefined && input.clientVisible !== task.clientVisible) {
    await recordActivity({
      orgId: auth.orgId,
      projectId: task.projectId,
      taskId: task.id,
      actorId: auth.userId,
      kind: 'VISIBILITY_CHANGED',
      detail: { taskKey: task.key, to: input.clientVisible ? 'visible' : 'hidden' },
      clientVisible: false,
    });
  }

  return updatedTask;
}

export async function archiveTask(auth: AuthContext, taskKey: string): Promise<void> {
  const task = await getTaskByKey(auth, taskKey);

  if (auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('Only a project manager can archive a task');
  }

  await Task.updateMany(
    { $or: [{ _id: task.id }, { parentId: task.id }] },
    { archivedAt: new Date() }
  );

  logger.info({ taskKey: task.key, by: auth.userId }, 'Task archived');
}

async function assertProjectMember(projectId: string, userId: string): Promise<void> {
  const member = await ProjectMember.findOne({ projectId, userId });
  if (!member) {
    throw AppError.validation('That person is not on this project', {
      issues: { assigneeId: ['Add them to the project before assigning work to them'] },
    });
  }
}
