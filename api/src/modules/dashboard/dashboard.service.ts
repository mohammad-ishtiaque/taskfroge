import type { AuthContext } from '../../middleware/authenticate';
import { listActivity } from '../activity/activity.service';
import {
  Project,
  ProjectMember,
  ProjectVisibility,
  Task,
  User,
  UserDocument,
  ProjectDocument,
  TaskStatus,
  TaskType,
  Priority,
} from '../../models';

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

function toCard(t: any, opts: { hideAssignee?: boolean; hideDueDate?: boolean; hideBlockedReason?: boolean } = {}): TaskCard {
  return {
    id: t.id ?? t._id.toString(),
    key: t.key,
    title: t.title,
    status: t.status,
    priority: t.priority,
    type: t.type,
    dueDate: opts.hideDueDate ? null : (t.dueDate ? new Date(t.dueDate) : null),
    assigneeName: opts.hideAssignee ? null : (t.assigneeId?.name ?? t.assigneeName ?? null),
    projectKey: t.projectId?.key ?? t.projectKey ?? '',
    blockedReason: opts.hideBlockedReason ? null : (t.blockedReason ?? null),
  };
}

export async function getDashboard(auth: AuthContext, workspaceId: string): Promise<Dashboard> {
  let projectDocs: any[];
  if (auth.role === 'PROJECT_MANAGER') {
    projectDocs = await Project.find({ orgId: auth.orgId, workspaceId, archivedAt: null }).sort({ createdAt: -1 });
  } else {
    const memberRecords = await ProjectMember.find({ userId: auth.userId }).select('projectId');
    const projectIds = memberRecords.map((m) => m.projectId.toString());
    projectDocs = await Project.find({ _id: { $in: projectIds }, orgId: auth.orgId, workspaceId, archivedAt: null }).sort({ createdAt: -1 });
  }

  const summaries: ProjectSummary[] = await Promise.all(
    projectDocs.map(async (p) => {
      const [memberCount, tasks] = await Promise.all([
        ProjectMember.countDocuments({ projectId: p.id }),
        Task.find({ projectId: p.id, archivedAt: null, parentId: null }).select('status'),
      ]);

      const total = tasks.length;
      const done = tasks.filter((t) => t.status === 'DONE').length;

      return {
        id: p.id,
        key: p.key,
        name: p.name,
        status: p.status,
        priority: p.priority,
        endDate: p.endDate ?? null,
        progress: total === 0 ? 0 : Math.round((done / total) * 100),
        memberCount,
      };
    })
  );

  const projectIds = projectDocs.map((p) => p.id);
  const activity = await listActivity(auth, { workspaceId, limit: 8 });
  const base: Base = { workspaceId, projects: summaries, activity };

  const taskScope: any = {
    orgId: auth.orgId,
    archivedAt: null,
    parentId: null,
    projectId: { $in: projectIds },
  };

  if (auth.role === 'CLIENT') return clientDashboard(base, taskScope, projectDocs);
  if (auth.role === 'PROJECT_MANAGER') return managerDashboard(base, taskScope);
  return developerDashboard(auth, base, taskScope);
}

async function clientDashboard(
  base: Base,
  scope: any,
  projects: any[],
): Promise<ClientDashboard> {
  const visible = { ...scope, clientVisible: true };

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [completedThisWeek, blocked, upcoming] = await Promise.all([
    Task.find({ ...visible, status: 'DONE', updatedAt: { $gte: weekAgo } })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .sort({ updatedAt: -1 })
      .limit(8),
    Task.find({ ...visible, status: 'BLOCKED' })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .limit(8),
    Task.find({ ...visible, status: { $ne: 'DONE' }, dueDate: { $gte: new Date() } })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .sort({ dueDate: 1 })
      .limit(8),
  ]);

  const visibilities = await Promise.all(
    projects.map((p) => ProjectVisibility.findOne({ projectId: p.id }))
  );

  const opts = {
    hideAssignee: visibilities.some((v) => v && !v.showAssignees),
    hideDueDate: visibilities.some((v) => v && !v.showDueDates),
    hideBlockedReason: visibilities.some((v) => v && !v.showBlockedReasons),
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

async function managerDashboard(
  base: Base,
  scope: any,
): Promise<ManagerDashboard> {
  const now = new Date();

  const [blocked, overdue, awaitingReview, assigneeGroups, overdueGroups] = await Promise.all([
    Task.find({ ...scope, status: 'BLOCKED' })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .limit(10),
    Task.find({ ...scope, status: { $ne: 'DONE' }, dueDate: { $lt: now } })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .sort({ dueDate: 1 })
      .limit(10),
    Task.find({ ...scope, status: 'IN_REVIEW' })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .limit(10),
    Task.aggregate([
      { $match: { ...scope, status: { $ne: 'DONE' }, assigneeId: { $ne: null } } },
      { $group: { _id: '$assigneeId', count: { $sum: 1 } } },
    ]),
    Task.aggregate([
      { $match: { ...scope, status: { $ne: 'DONE' }, dueDate: { $lt: now }, assigneeId: { $ne: null } } },
      { $group: { _id: '$assigneeId', count: { $sum: 1 } } },
    ]),
  ]);

  const overdueMap = new Map(overdueGroups.map((r: any) => [r._id.toString(), r.count]));

  const assigneeUserIds = assigneeGroups.map((r: any) => r._id.toString());
  const users = await User.find({ _id: { $in: assigneeUserIds } }).select('id name');

  const workload = assigneeGroups
    .map((row: any) => {
      const uId = row._id.toString();
      const u = users.find((user) => user.id === uId);
      return {
        userId: uId,
        name: u?.name ?? '',
        open: row.count,
        overdue: overdueMap.get(uId) ?? 0,
      };
    })
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

async function developerDashboard(
  auth: AuthContext,
  base: Base,
  scope: any,
): Promise<DeveloperDashboard> {
  const mine = { ...scope, assigneeId: auth.userId, status: { $ne: 'DONE' } };

  const [myTasks, overdue, inProgress] = await Promise.all([
    Task.find(mine)
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .sort({ priority: 1, dueDate: 1 })
      .limit(10),
    Task.find({ ...mine, dueDate: { $lt: new Date() } })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .sort({ dueDate: 1 })
      .limit(10),
    Task.find({ ...mine, status: 'IN_PROGRESS' })
      .populate<{ assigneeId: UserDocument }>('assigneeId', 'name')
      .populate<{ projectId: ProjectDocument }>('projectId', 'key')
      .limit(10),
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

export async function getProjectStats(auth: AuthContext, projectId: string) {
  const query: any = {
    orgId: auth.orgId,
    projectId,
    archivedAt: null,
  };

  if (auth.role === 'CLIENT') {
    query.clientVisible = true;
  }

  const [byStatusGroup, byTypeGroup, byPriorityGroup, total, overdue, members] = await Promise.all([
    Task.aggregate([{ $match: query }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: query }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: query }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
    Task.countDocuments(query),
    Task.countDocuments({ ...query, status: { $ne: 'DONE' }, dueDate: { $lt: new Date() } }),
    ProjectMember.countDocuments({ projectId }),
  ]);

  const statusCounts = tally(byStatusGroup, TaskStatus);
  const completed = statusCounts.DONE ?? 0;

  return {
    totalTasks: total,
    completedTasks: completed,
    inProgressTasks: statusCounts.IN_PROGRESS ?? 0,
    overdueTasks: overdue,
    teamSize: members,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    byStatus: statusCounts,
    byType: tally(byTypeGroup, TaskType),
    byPriority: tally(byPriorityGroup, Priority),
  };
}

function tally<T extends string>(
  rows: { _id: string; count: number }[],
  members: Record<string, T>,
): Record<T, number> {
  const counts = Object.fromEntries(Object.values(members).map((value) => [value, 0])) as Record<
    T,
    number
  >;

  for (const row of rows) {
    const key = row._id as T;
    if (key && counts[key] !== undefined) {
      counts[key] = row.count;
    }
  }

  return counts;
}
