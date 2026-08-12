import type { Prisma, Priority, Task, TaskStatus, TaskType } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import type { AuthContext } from '../../middleware/authenticate';
import { personSelect, toTask, toTasks } from '../../lib/serialize';
import { recordActivity } from '../activity/activity.service';
import { notify } from '../notifications/notifications.service';

/* ==========================================================================
   Tasks
   --------------------------------------------------------------------------
   Three rules govern this file, and each exists because getting it wrong is
   expensive rather than merely untidy:

   1. **A client never receives a hidden task.** Filtered in the WHERE clause,
      not stripped after the query. A response body a client can open in the
      network tab must not contain it.
   2. **A missing task is 404, never 403.** A 403 confirms the task exists,
      which is itself the leak.
   3. **Task keys are allocated atomically.** Two people pressing Create at the
      same moment must not both get WEB-142.
   ========================================================================== */

/* ── Scoping ────────────────────────────────────────────────────────────── */

/**
 * Which projects this caller may see at all.
 *
 * A project manager sees every project in the organisation. Everyone else sees
 * only projects they are a member of. Every task query composes this, so there
 * is no path to a task in a project you cannot reach.
 */
function projectScope(auth: AuthContext): Prisma.ProjectWhereInput {
  if (auth.role === 'PROJECT_MANAGER') return { orgId: auth.orgId, archivedAt: null };
  return {
    orgId: auth.orgId,
    archivedAt: null,
    members: { some: { userId: auth.userId } },
  };
}

/**
 * The task-level filter for a caller.
 *
 * The `clientVisible` clause is the whole of docs/04 §5 in one line, and it is
 * applied here rather than in each route so a new endpoint cannot forget it.
 */
function taskScope(auth: AuthContext): Prisma.TaskWhereInput {
  const base: Prisma.TaskWhereInput = {
    orgId: auth.orgId,
    archivedAt: null,
    project: projectScope(auth),
  };

  if (auth.role === 'CLIENT') base.clientVisible = true;
  return base;
}

/** Resolves a project by key, or 404. Used by every route that takes a key. */
export async function requireProject(auth: AuthContext, key: string) {
  const project = await prisma.project.findFirst({
    where: { ...projectScope(auth), key: key.toUpperCase() },
    include: { visibility: true },
  });

  if (!project) throw AppError.notFound('Project');
  return project;
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

export interface ListTaskFilters {
  status?: TaskStatus;
  // The enums, not `string`. The route validates these before we see them, so
  // widening to `string` bought nothing and hid the fact that an unchecked
  // caller could put an arbitrary value into a WHERE clause.
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
): Promise<Task[]> {
  const where: Prisma.TaskWhereInput = { ...taskScope(auth), projectId };

  // Subtasks are excluded by default: the list and board are about parent
  // work, and mixing them in makes a project of 40 tasks look like 120.
  if (!filters.includeSubtasks) where.parentId = null;

  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;

  if (filters.assigneeId) {
    where.assigneeId = filters.assigneeId === 'UNASSIGNED' ? null : filters.assigneeId;
  }

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { key: { contains: filters.search.toUpperCase() } },
    ];
  }

  const tasks = await prisma.task.findMany({
    where,
    include: {
      assignee: { select: personSelect(auth.orgId) },
      reporter: { select: personSelect(auth.orgId) },
      _count: { select: { subtasks: true } },
    },
    orderBy: [{ status: 'asc' }, { priority: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }],
  });

  return toTasks(tasks) as unknown as Task[];
}

export async function getTaskByKey(auth: AuthContext, key: string): Promise<Task> {
  const task = await prisma.task.findFirst({
    where: { ...taskScope(auth), key: key.toUpperCase() },
    include: {
      assignee: { select: personSelect(auth.orgId) },
      reporter: { select: personSelect(auth.orgId) },
      project: {
        include: {
          visibility: true,
          members: { select: { userId: true } },
          tasks: { where: { archivedAt: null }, select: { status: true, parentId: true } },
        },
      },
      subtasks: {
        where: { archivedAt: null },
        include: { assignee: { select: personSelect(auth.orgId) } },
      },
    },
  });

  // 404 and not 403 — see the header of this file.
  if (!task) throw AppError.notFound('Task');
  return toTask(task) as unknown as Task;
}

export async function listSubtasks(auth: AuthContext, parentId: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: { ...taskScope(auth), parentId },
    include: { assignee: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Everything assigned to the caller, across every project they can reach. */
export async function listMyTasks(auth: AuthContext, workspaceId?: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      ...taskScope(auth),
      assigneeId: auth.userId,
      status: { not: 'DONE' },
      ...(workspaceId ? { project: { ...projectScope(auth), workspaceId } } : {}),
    },
    include: { project: { select: { key: true, name: true } } },
    orderBy: { dueDate: { sort: 'asc', nulls: 'last' } },
  });
}

/* ── Key allocation ─────────────────────────────────────────────────────── */

/**
 * Allocates the next task number for a project, atomically.
 *
 * `SELECT max(number) + 1` in application code is a race: two concurrent
 * creates read the same maximum and both write it, and the unique constraint
 * then rejects one of them with an error the user did not cause.
 *
 * So the number is allocated under a row lock on the project, inside the
 * caller's transaction. Serialising on the project row is exactly the
 * granularity we want — two people creating tasks in different projects never
 * wait on each other.
 */
async function nextTaskNumber(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  // Take the lock on the *project* row. PostgreSQL refuses FOR UPDATE in a
  // statement containing an aggregate, and locking the project is the right
  // granularity regardless: concurrent creates in different projects never
  // block each other, and concurrent creates in the same one queue up here.
  await tx.$queryRawUnsafe(`SELECT "id" FROM "Project" WHERE "id" = $1::uuid FOR UPDATE`, projectId);

  const rows = await tx.$queryRawUnsafe<{ next: bigint }[]>(
    `SELECT COALESCE(MAX("number"), 0) + 1 AS next FROM "Task" WHERE "projectId" = $1::uuid`,
    projectId,
  );

  return Number(rows[0]?.next ?? 1);
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

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
): Promise<Task> {
  const project = await requireProject(auth, projectKey);

  // A client can report a bug but cannot create work for the team, and cannot
  // assign it to anyone. That is the M1 permission table, applied here.
  if (auth.role === 'CLIENT' && input.assigneeId) {
    throw AppError.forbidden('Clients cannot assign tasks');
  }

  if (input.assigneeId) await assertProjectMember(project.id, input.assigneeId);

  if (input.parentId) {
    const parent = await prisma.task.findFirst({
      where: { ...taskScope(auth), id: input.parentId },
    });
    if (!parent) throw AppError.notFound('Parent task');

    // One level of nesting. Subtasks of subtasks turn a task list into a tree
    // nobody can hold in their head, and every view would need recursion.
    if (parent.parentId) throw AppError.validation('A subtask cannot have subtasks');
    if (parent.projectId !== project.id) {
      throw AppError.validation('A subtask must be in the same project as its parent');
    }
  }

  const task = await prisma.$transaction(async (tx) => {
    const number = await nextTaskNumber(tx, project.id);

    return tx.task.create({
      data: {
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
        // Inherits the project's preset rather than defaulting to visible. A
        // SUMMARY project must not quietly start showing the client everything
        // the moment someone adds a task.
        clientVisible: project.visibility?.preset !== 'SUMMARY',
      },
      include: {
        assignee: { select: personSelect(auth.orgId) },
        reporter: { select: personSelect(auth.orgId) },
      },
    });
  });

  await recordActivity({
    orgId: auth.orgId,
    projectId: project.id,
    taskId: task.id,
    actorId: auth.userId,
    kind: 'TASK_CREATED',
    detail: { taskKey: task.key },
    clientVisible: task.clientVisible,
  });

  if (task.assigneeId && task.assigneeId !== auth.userId) {
    await notify({
      orgId: auth.orgId,
      recipientId: task.assigneeId,
      actorId: auth.userId,
      kind: 'ASSIGNED',
      task,
      projectKey: project.key,
    });
  }

  logger.info({ taskKey: task.key, by: auth.userId }, 'Task created');
  return toTask(task) as unknown as Task;
}

/**
 * Which transitions are legal, and who may make them.
 *
 * Written as data rather than as a chain of ifs: a state machine you can read
 * in one place is a state machine you can reason about, and this one is quoted
 * directly in the design doc.
 *
 * The one restriction that matters commercially: **only a project manager
 * moves work to DONE.** A developer marks it IN_REVIEW; someone else agrees it
 * is finished. Self-approval is how "done" stops meaning anything.
 */
const PM_ONLY_TRANSITIONS: readonly TaskStatus[] = ['DONE'];

export interface UpdateStatusInput {
  status: TaskStatus;
  blockedReason?: string;
}

export async function updateTaskStatus(
  auth: AuthContext,
  taskKey: string,
  input: UpdateStatusInput,
): Promise<Task> {
  const task = await getTaskByKey(auth, taskKey);

  if (auth.role === 'CLIENT') throw AppError.forbidden('Clients cannot change task status');

  // A developer may only move their own work. Anyone can be wrong about
  // someone else's task; only the assignee knows theirs is finished.
  if (auth.role === 'DEVELOPER' && task.assigneeId !== auth.userId) {
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

  // A parent cannot close over open subtasks. Enforced here rather than in the
  // UI so the board, the table and the detail screen cannot disagree.
  if (input.status === 'DONE') {
    const open = await prisma.task.count({
      where: { parentId: task.id, archivedAt: null, status: { not: 'DONE' } },
    });
    if (open > 0) {
      throw AppError.conflict('Finish the subtasks before closing this task', {
        code: 'SUBTASKS_OPEN',
        openSubtasks: open,
      });
    }
  }

  if (task.status === input.status) return task;

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      status: input.status,
      blockedReason: input.status === 'BLOCKED' ? (input.blockedReason ?? null) : null,
      // Clearing these on any status change means moving a task back into
      // play re-arms its deadline reminder, which is the behaviour a person
      // expects and the flags would otherwise silently suppress.
      reminderSentAt: null,
      overdueNotified: false,
    },
    include: {
      assignee: { select: personSelect(auth.orgId) },
      reporter: { select: personSelect(auth.orgId) },
    },
  });

  await recordActivity({
    orgId: auth.orgId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: auth.userId,
    kind: input.status === 'BLOCKED' ? 'BLOCKED' : task.status === 'BLOCKED' ? 'UNBLOCKED' : 'STATUS_CHANGED',
    detail: { taskKey: task.key, from: task.status, to: input.status },
    clientVisible: task.clientVisible,
  });

  // Tell the assignee, unless they are the one who moved it.
  if (updated.assigneeId && updated.assigneeId !== auth.userId) {
    await notify({
      orgId: auth.orgId,
      recipientId: updated.assigneeId,
      actorId: auth.userId,
      kind: 'STATUS_CHANGED',
      task: updated,
      projectKey: taskKey.split('-')[0]!,
    });
  }

  return toTask(updated) as unknown as Task;
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
): Promise<Task> {
  const task = await getTaskByKey(auth, taskKey);

  if (auth.role === 'CLIENT') throw AppError.forbidden('Clients cannot edit tasks');

  // A developer edits their own task's working fields. Reassigning it, moving
  // its deadline, or changing what the client sees are the PM's decisions.
  if (auth.role === 'DEVELOPER') {
    if (task.assigneeId !== auth.userId) {
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

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
      ...(input.dueDate !== undefined && {
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        reminderSentAt: null,
        overdueNotified: false,
      }),
      ...(input.estimateHours !== undefined && { estimateHours: input.estimateHours }),
      ...(input.loggedHours !== undefined && { loggedHours: input.loggedHours }),
      ...(input.clientVisible !== undefined && { clientVisible: input.clientVisible }),
    },
    include: {
      assignee: { select: personSelect(auth.orgId) },
      reporter: { select: personSelect(auth.orgId) },
    },
  });

  if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) {
    await recordActivity({
      orgId: auth.orgId,
      projectId: task.projectId,
      taskId: task.id,
      actorId: auth.userId,
      kind: 'ASSIGNED',
      detail: { taskKey: task.key },
      clientVisible: updated.clientVisible,
    });

    if (input.assigneeId && input.assigneeId !== auth.userId) {
      await notify({
        orgId: auth.orgId,
        recipientId: input.assigneeId,
        actorId: auth.userId,
        kind: 'ASSIGNED',
        task: updated,
        projectKey: taskKey.split('-')[0]!,
      });
    }
  }

  // "When did this become visible to the client?" gets asked after the fact,
  // so the answer has to already be written down.
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

  return updated;
}

/**
 * Archive rather than delete.
 *
 * A deleted task takes its comments, its activity and its key with it, and the
 * key is the thing people wrote in a Slack message three weeks ago.
 */
export async function archiveTask(auth: AuthContext, taskKey: string): Promise<void> {
  const task = await getTaskByKey(auth, taskKey);

  if (auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('Only a project manager can archive a task');
  }

  await prisma.task.updateMany({
    where: { OR: [{ id: task.id }, { parentId: task.id }] },
    data: { archivedAt: new Date() },
  });

  logger.info({ taskKey: task.key, by: auth.userId }, 'Task archived');
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * You cannot assign work to someone who is not on the project.
 *
 * Without this, a PM could assign a task to a developer who then cannot open
 * it — the task list scopes by membership — and the developer would be
 * accountable for work they cannot see.
 */
async function assertProjectMember(projectId: string, userId: string): Promise<void> {
  const member = await prisma.projectMember.findFirst({ where: { projectId, userId } });
  if (!member) {
    throw AppError.validation('That person is not on this project', {
      issues: { assigneeId: ['Add them to the project before assigning work to them'] },
    });
  }
}
