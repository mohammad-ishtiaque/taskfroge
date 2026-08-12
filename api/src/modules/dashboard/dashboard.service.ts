import { Priority, TaskStatus, TaskType, type Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import type { AuthContext } from '../../middleware/authenticate';
import { listActivity } from '../activity/activity.service';

/* ==========================================================================
   Dashboards
   --------------------------------------------------------------------------
   Three roles, three shapes. This is not decoration.

   The first version returned one shape for everyone, and looking at the real
   data showed why that fails: "My Tasks" and "Overdue" are counts of work
   *assigned to you*, and a client is never an assignee. Their dashboard was
   two stat cards reading zero and three empty lists — structurally, on every
   project, forever. A project manager fared little better, because a PM
   assigns work rather than holding it.

   So each role gets the numbers that are true for it:

     Client     — is my project moving, what finished, what is waiting on me
     PM         — where is the team stuck, what is late, what needs approval
     Developer  — what is on my plate, in what order

   The discriminated union is what makes this safe: a screen that renders
   `dashboard.blocked` has to prove it is looking at the PM shape first.
   ========================================================================== */

export type Dashboard = ClientDashboard | ManagerDashboard | DeveloperDashboard;

interface Base {
  workspaceId: string;
  projects: ProjectSummary[];
  activity: Awaited<ReturnType<typeof listActivity>>;
}

interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  status: string;
  priority: string;
  endDate: Date | null;
  progress: number;
  memberCount: number;
}

export interface ClientDashboard extends Base {
  role: 'CLIENT';
  totals: { projects: number; completedThisWeek: number; waitingOnYou: number; upcoming: number };
  completedThisWeek: TaskCard[];
  waitingOnYou: TaskCard[];
  upcoming: TaskCard[];
}

export interface ManagerDashboard extends Base {
  role: 'PROJECT_MANAGER';
  totals: { projects: number; activeProjects: number; blocked: number; overdue: number; awaitingReview: number };
  blocked: TaskCard[];
  overdue: TaskCard[];
  awaitingReview: TaskCard[];
  workload: { userId: string; name: string; open: number; overdue: number }[];
}

export interface DeveloperDashboard extends Base {
  role: 'DEVELOPER';
  totals: { projects: number; myTasks: number; overdue: number; inProgress: number };
  myTasks: TaskCard[];
  overdue: TaskCard[];
  inProgress: TaskCard[];
}

interface TaskCard {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  dueDate: Date | null;
  assigneeName: string | null;
  projectKey: string;
  blockedReason: string | null;
}

const CARD_SELECT = {
  id: true,
  key: true,
  title: true,
  status: true,
  priority: true,
  type: true,
  dueDate: true,
  blockedReason: true,
  clientVisible: true,
  assignee: { select: { name: true } },
  project: { select: { key: true } },
} as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toCard(t: any, opts: { hideAssignee?: boolean; hideDueDate?: boolean; hideBlockedReason?: boolean } = {}): TaskCard {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    status: t.status,
    priority: t.priority,
    type: t.type,
    dueDate: opts.hideDueDate ? null : t.dueDate,
    assigneeName: opts.hideAssignee ? null : (t.assignee?.name ?? null),
    projectKey: t.project?.key ?? '',
    blockedReason: opts.hideBlockedReason ? null : t.blockedReason,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getDashboard(auth: AuthContext, workspaceId: string): Promise<Dashboard> {
  const projectWhere: Prisma.ProjectWhereInput =
    auth.role === 'PROJECT_MANAGER'
      ? { orgId: auth.orgId, workspaceId, archivedAt: null }
      : { orgId: auth.orgId, workspaceId, archivedAt: null, members: { some: { userId: auth.userId } } };

  const projects = await prisma.project.findMany({
    where: projectWhere,
    include: {
      _count: { select: { members: true } },
      tasks: { where: { archivedAt: null, parentId: null }, select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const summaries: ProjectSummary[] = projects.map((p) => {
    // Progress is computed from parent tasks only. Counting subtasks would let
    // a task split into ten pieces move the bar ten times as far as one that
    // was not, which is a reporting artefact rather than progress.
    const total = p.tasks.length;
    const done = p.tasks.filter((t: { status: string }) => t.status === 'DONE').length;

    return {
      id: p.id,
      key: p.key,
      name: p.name,
      status: p.status,
      priority: p.priority,
      endDate: p.endDate,
      progress: total === 0 ? 0 : Math.round((done / total) * 100),
      memberCount: p._count.members,
    };
  });

  const projectIds = projects.map((p) => p.id);
  const activity = await listActivity(auth, { workspaceId, limit: 8 });
  const base: Base = { workspaceId, projects: summaries, activity };

  const scope: Prisma.TaskWhereInput = {
    orgId: auth.orgId,
    archivedAt: null,
    parentId: null,
    projectId: { in: projectIds },
  };

  if (auth.role === 'CLIENT') return clientDashboard(base, scope, projects);
  if (auth.role === 'PROJECT_MANAGER') return managerDashboard(base, scope);
  return developerDashboard(auth, base, scope);
}

/* ── Client ─────────────────────────────────────────────────────────────── */

async function clientDashboard(
  base: Base,
  scope: Prisma.TaskWhereInput,
  projects: { id: string; visibility?: { showAssignees: boolean; showDueDates: boolean; showBlockedReasons: boolean } | null }[],
): Promise<ClientDashboard> {
  // Hidden tasks are excluded from every list below, in the query.
  const visible: Prisma.TaskWhereInput = { ...scope, clientVisible: true };

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [completedThisWeek, blocked, upcoming] = await Promise.all([
    prisma.task.findMany({
      where: { ...visible, status: 'DONE', updatedAt: { gte: weekAgo } },
      select: CARD_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),
    // "Waiting on you" rather than "blocked" — the client cares about the
    // subset that is their move to make, and the blocked reason is the only
    // place that distinction is written down.
    prisma.task.findMany({
      where: { ...visible, status: 'BLOCKED' },
      select: CARD_SELECT,
      take: 8,
    }),
    prisma.task.findMany({
      where: { ...visible, status: { notIn: ['DONE'] }, dueDate: { gte: new Date() } },
      select: CARD_SELECT,
      orderBy: { dueDate: 'asc' },
      take: 8,
    }),
  ]);

  // Field-level redaction uses the least permissive setting across the
  // projects in view. A dashboard spans projects, and showing an assignee
  // because *one* project allows it would leak from the others.
  const opts = {
    hideAssignee: projects.some((p) => p.visibility && !p.visibility.showAssignees),
    hideDueDate: projects.some((p) => p.visibility && !p.visibility.showDueDates),
    hideBlockedReason: projects.some((p) => p.visibility && !p.visibility.showBlockedReasons),
  };

  return {
    ...base,
    role: 'CLIENT',
    totals: {
      projects: base.projects.length,
      completedThisWeek: completedThisWeek.length,
      waitingOnYou: blocked.length,
      upcoming: upcoming.length,
    },
    completedThisWeek: completedThisWeek.map((t) => toCard(t, opts)),
    waitingOnYou: blocked.map((t) => toCard(t, opts)),
    upcoming: upcoming.map((t) => toCard(t, opts)),
  };
}

/* ── Project manager ────────────────────────────────────────────────────── */

async function managerDashboard(
  base: Base,
  scope: Prisma.TaskWhereInput,
): Promise<ManagerDashboard> {
  const now = new Date();

  const [blocked, overdue, awaitingReview, assignees] = await Promise.all([
    prisma.task.findMany({ where: { ...scope, status: 'BLOCKED' }, select: CARD_SELECT, take: 10 }),
    prisma.task.findMany({
      where: { ...scope, status: { not: 'DONE' }, dueDate: { lt: now } },
      select: CARD_SELECT,
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
    // IN_REVIEW is work sitting on the PM's own desk — only they can mark it
    // done, so this is their queue, not a status report.
    prisma.task.findMany({ where: { ...scope, status: 'IN_REVIEW' }, select: CARD_SELECT, take: 10 }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { ...scope, status: { not: 'DONE' }, assigneeId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const overdueByUser = await prisma.task.groupBy({
    by: ['assigneeId'],
    where: { ...scope, status: { not: 'DONE' }, dueDate: { lt: now }, assigneeId: { not: null } },
    _count: { _all: true },
  });

  const overdueMap = new Map(
    overdueByUser.map((r: { assigneeId: string | null; _count: { _all: number } }) => [
      r.assigneeId,
      r._count._all,
    ]),
  );

  const users = await prisma.user.findMany({
    where: { id: { in: assignees.map((a: { assigneeId: string | null }) => a.assigneeId!).filter(Boolean) } },
    select: { id: true, name: true },
  });

  const workload = assignees
    .map((row: { assigneeId: string | null; _count: { _all: number } }) => ({
      userId: row.assigneeId!,
      name: users.find((u) => u.id === row.assigneeId)?.name ?? '',
      open: row._count._all,
      overdue: overdueMap.get(row.assigneeId) ?? 0,
    }))
    // Busiest first: the point of this list is spotting who is overloaded.
    .sort((a, b) => b.open - a.open);

  return {
    ...base,
    role: 'PROJECT_MANAGER',
    totals: {
      projects: base.projects.length,
      activeProjects: base.projects.filter((p) => p.status === 'ACTIVE').length,
      blocked: blocked.length,
      overdue: overdue.length,
      awaitingReview: awaitingReview.length,
    },
    blocked: blocked.map((t) => toCard(t)),
    overdue: overdue.map((t) => toCard(t)),
    awaitingReview: awaitingReview.map((t) => toCard(t)),
    workload,
  };
}

/* ── Developer ──────────────────────────────────────────────────────────── */

async function developerDashboard(
  auth: AuthContext,
  base: Base,
  scope: Prisma.TaskWhereInput,
): Promise<DeveloperDashboard> {
  const mine: Prisma.TaskWhereInput = { ...scope, assigneeId: auth.userId, status: { not: 'DONE' } };

  const [myTasks, overdue, inProgress] = await Promise.all([
    prisma.task.findMany({
      where: mine,
      select: CARD_SELECT,
      orderBy: [{ priority: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }],
      take: 10,
    }),
    prisma.task.findMany({
      where: { ...mine, dueDate: { lt: new Date() } },
      select: CARD_SELECT,
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
    prisma.task.findMany({ where: { ...mine, status: 'IN_PROGRESS' }, select: CARD_SELECT, take: 10 }),
  ]);

  return {
    ...base,
    role: 'DEVELOPER',
    totals: {
      projects: base.projects.length,
      myTasks: myTasks.length,
      overdue: overdue.length,
      inProgress: inProgress.length,
    },
    myTasks: myTasks.map((t) => toCard(t)),
    overdue: overdue.map((t) => toCard(t)),
    inProgress: inProgress.map((t) => toCard(t)),
  };
}

/* ── Project stats, for the analytics tab ───────────────────────────────── */

export async function getProjectStats(auth: AuthContext, projectId: string) {
  const where: Prisma.TaskWhereInput = {
    orgId: auth.orgId,
    projectId,
    archivedAt: null,
    ...(auth.role === 'CLIENT' ? { clientVisible: true } : {}),
  };

  const [byStatus, byType, byPriority, total, overdue, members] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['type'], where, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['priority'], where, _count: { _all: true } }),
    prisma.task.count({ where }),
    prisma.task.count({ where: { ...where, status: { not: 'DONE' }, dueDate: { lt: new Date() } } }),
    prisma.projectMember.count({ where: { projectId } }),
  ]);

  const statusCounts = tally(byStatus, 'status', TaskStatus);
  const completed = statusCounts.DONE ?? 0;

  return {
    totalTasks: total,
    completedTasks: completed,
    inProgressTasks: statusCounts.IN_PROGRESS ?? 0,
    overdueTasks: overdue,
    teamSize: members,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    byStatus: statusCounts,
    byType: tally(byType, 'type', TaskType),
    byPriority: tally(byPriority, 'priority', Priority),
  };
}

/**
 * A `groupBy` result turned into a count for **every** member of the enum.
 *
 * The zero-filled base is the whole point. `groupBy` only returns rows that
 * exist, so a project with one in-progress task came back as `{IN_PROGRESS: 1}`
 * — no TODO, no DONE, no BLOCKED. The analytics screen then computed
 * `count / total * 100` for each status and rendered `NaN%` down the page,
 * and `IN_PROGRESS + IN_REVIEW + BLOCKED` for its "active" card, which is
 * `1 + undefined + undefined` — `NaN` in a stat card.
 *
 * The web tier's type said `Record<TaskStatus, number>`, which was simply a
 * false statement about what this function returned. TypeScript believed it on
 * both sides and nothing compared them. Filling the record here makes the type
 * true rather than making every reader defend against it.
 */
function tally<T extends string>(
  rows: { _count: { _all: number } }[],
  key: string,
  members: Record<string, T>,
): Record<T, number> {
  const counts = Object.fromEntries(Object.values(members).map((value) => [value, 0])) as Record<
    T,
    number
  >;

  for (const row of rows) {
    const value = (row as unknown as Record<string, T>)[key];
    if (value !== undefined) counts[value] = row._count._all;
  }

  return counts;
}
