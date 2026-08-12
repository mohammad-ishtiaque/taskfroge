import { callApi } from '~/lib/api.server';
import type {
  Activity,
  Comment,
  Notification,
  Person,
  Priority,
  Project,
  ProjectStats,
  Task,
  TaskStatus,
  TaskType,
  VisibilityPreset,
  Workspace,
} from './types';

/* ==========================================================================
   The data gateway — now backed by the API
   --------------------------------------------------------------------------
   Every screen gets its data from this file and nothing else. Until now each
   function read an in-memory mock; each one is now a call to the API. No
   screen changed, which is the entire reason the seam was built this way.

   Three things changed shape, and all three are improvements:

   1. **`viewer: Viewer` became `request: Request`.** The gateway no longer
      decides who is asking — `callApi` attaches the caller's bearer token and
      the API answers for the identity in it. Identity belongs on the server
      that owns the data, not in a helper the browser can influence.

   2. **Everything is async.** Typecheck finds every caller that forgot to
      await, because a Promise where an object is expected is a compile error.

   3. **`toClientTask` is gone.** Redaction used to happen here, in the web
      tier. It now happens in the API, which is the only place it can be
      trusted: a client's task list arrives already filtered, and there is no
      code path in the browser tier that could forget to apply it.

   Errors are not caught here. `callApi` normalises every failure into
   `ApiError` with a stable `code`, and routes translate that code for the
   reader. Swallowing them here would mean every screen inventing its own idea
   of what an empty result means.
   ========================================================================== */

/* ── People ─────────────────────────────────────────────────────────────── */

/**
 * People who can be assigned work on a project.
 *
 * Scoped to a project rather than the organisation: assigning a task to
 * someone who is not a member creates work they cannot open, and the API
 * refuses it anyway.
 */
export async function listAssignable(request: Request, projectKey: string): Promise<Person[]> {
  return callApi<Person[]>(`/projects/${projectKey}/assignable`, { request });
}

/**
 * Who is *on* the project.
 *
 * Not the same as `listAssignable`, which returns everyone in the workspace
 * who is **not** yet a member — the "add someone" list. Using that one for the
 * team page showed everybody except the team.
 */
export async function listMembers(request: Request, projectKey: string): Promise<Person[]> {
  return callApi<Person[]>(`/projects/${projectKey}/members`, { request });
}

/* ── Workspaces ─────────────────────────────────────────────────────────── */

export async function listWorkspaces(request: Request): Promise<Workspace[]> {
  return callApi<Workspace[]>('/workspaces', { request });
}

export async function getWorkspace(request: Request, slug: string): Promise<Workspace> {
  // Throws ApiError('NOT_FOUND') rather than returning null. A caller that
  // forgets to check a null cannot leak anything if there is no null.
  return callApi<Workspace>(`/workspaces/${slug}`, { request });
}

export async function createWorkspace(
  request: Request,
  input: { name: string; clientName: string },
): Promise<Workspace> {
  return callApi<Workspace>('/workspaces', { method: 'POST', request, body: input });
}

export async function updateWorkspace(
  request: Request,
  slug: string,
  input: { name?: string; clientName?: string },
): Promise<Workspace> {
  return callApi<Workspace>(`/workspaces/${slug}`, { method: 'PATCH', request, body: input });
}

/* ── Projects ───────────────────────────────────────────────────────────── */

export interface ProjectFilters {
  workspaceId?: string;
  status?: string;
  priority?: string;
  search?: string;
  /** Archived projects are excluded by default. Without a way to ask for them
      the archive control would be a one-way door — you could put a project
      away and never find it again to restore it. */
  includeArchived?: boolean;
}

export async function listProjects(
  request: Request,
  filters: ProjectFilters = {},
): Promise<Project[]> {
  // `ALL` is the form's "no filter" value; sending it would have the API
  // match a status literally called ALL and return nothing.
  const query: Record<string, string | undefined> = {
    workspaceId: filters.workspaceId,
    status: filters.status === 'ALL' ? undefined : filters.status,
    priority: filters.priority === 'ALL' ? undefined : filters.priority,
    search: filters.search?.trim() || undefined,
    includeArchived: filters.includeArchived ? 'true' : undefined,
  };

  return callApi<Project[]>('/projects', { request, query });
}

export async function getProject(request: Request, key: string): Promise<Project> {
  return callApi<Project>(`/projects/${key}`, { request });
}

export async function getProjectStats(request: Request, key: string): Promise<ProjectStats> {
  return callApi<ProjectStats>(`/projects/${key}/stats`, { request });
}

export interface CreateProjectInput {
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
  priority?: Priority;
  startDate?: string | null;
  endDate?: string | null;
  leadId?: string | null;
  memberIds?: string[];
  visibility?: { preset: VisibilityPreset };
  /**
   * People to invite as the project is created. Up to 25.
   *
   * Best-effort by design: the project is created first and each invitation is
   * settled independently, so a typo in one address cannot roll back a project
   * that is otherwise fine. `CreateProjectResult.invitations` reports what
   * actually went out.
   */
  invites?: { email: string; role: Person['role'] }[];
}

/** What creating a project actually returns, invitation report and all. */
export interface CreateProjectResult {
  project: Project;
  invitations: { email: string; sent: boolean; outcome: string }[];
}

export async function createProject(
  request: Request,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  // The only endpoint that wraps its result, because it reports on the
  // invitations sent alongside. Typed honestly rather than pretending it
  // returns a bare Project — that pretence is what produced a redirect to
  // /projects/undefined/tasks.
  return callApi<CreateProjectResult>('/projects', {
    method: 'POST',
    request,
    body: input,
  });
}

export async function updateProject(
  request: Request,
  key: string,
  input: Partial<Pick<Project, 'name' | 'description' | 'status' | 'priority'>> & {
    startDate?: string | null;
    endDate?: string | null;
    leadId?: string | null;
  },
): Promise<Project> {
  return callApi<Project>(`/projects/${key}`, { method: 'PATCH', request, body: input });
}

export async function setProjectVisibility(
  request: Request,
  key: string,
  visibility: Project['visibility'],
): Promise<Project> {
  // PUT, not PATCH: the six toggles are replaced wholesale. A partial update
  // would leave a toggle at whatever it was, which is exactly the surprise
  // this screen must not produce.
  return callApi<Project>(`/projects/${key}/visibility`, {
    method: 'PUT',
    request,
    body: visibility,
  });
}

export async function addProjectMember(
  request: Request,
  key: string,
  userId: string,
): Promise<void> {
  await callApi(`/projects/${key}/members`, { method: 'POST', request, body: { userId } });
}

/**
 * Archive a project, and bring it back.
 *
 * Archive rather than delete, and it is not a soft-delete dressed up: an
 * archived project keeps every task, comment and hour logged against it. An
 * agency needs last year's work to answer "what did we bill for that", and a
 * DELETE that took the history with it would be the one action nobody could
 * undo.
 */
export async function archiveProject(request: Request, key: string): Promise<void> {
  await callApi(`/projects/${key}/archive`, { method: 'POST', request });
}

export async function restoreProject(request: Request, key: string): Promise<void> {
  await callApi(`/projects/${key}/restore`, { method: 'POST', request });
}

/* ── Comments ───────────────────────────────────────────────────────────── */

/**
 * Remove a comment. Yours, or anyone's if you are a project manager.
 *
 * A soft delete on the server, so a thread that referred to it still reads
 * sensibly and the activity feed does not develop a hole. The API decides who
 * may — this is only the call.
 */
export async function deleteComment(request: Request, id: string): Promise<void> {
  await callApi(`/comments/${id}`, { method: 'DELETE', request });
}

/* ── Invitations ────────────────────────────────────────────────────────── */

/**
 * Two outcomes, and the difference matters to whoever is reading the screen.
 *
 * Someone already in the organisation is added to the project outright — there
 * is no link for them to click, so telling the PM "invitation sent" would be a
 * lie they would wait on. Someone new gets an email and a pending row.
 */
export interface InviteResult {
  outcome: 'added' | 'invited';
  email: string;
  /** Only on `added` — the name we could resolve for them. */
  name?: string;
}

export async function inviteToProject(
  request: Request,
  key: string,
  input: { email: string; role: Person['role'] },
): Promise<InviteResult> {
  return callApi<InviteResult>(`/projects/${key}/invitations`, {
    method: 'POST',
    request,
    body: input,
  });
}

export async function revokeInvitation(request: Request, invitationId: string): Promise<void> {
  // Keyed by invitation rather than by project: the id is already unique, and
  // routing it through a project would let a caller pass a project they are on
  // with an invitation belonging to one they are not.
  await callApi(`/projects/invitations/${invitationId}`, { method: 'DELETE', request });
}

export async function removeProjectMember(
  request: Request,
  key: string,
  userId: string,
): Promise<void> {
  await callApi(`/projects/${key}/members/${userId}`, { method: 'DELETE', request });
}

/* ── Tasks ──────────────────────────────────────────────────────────────── */

export interface TaskFilters {
  status?: string;
  type?: string;
  priority?: string;
  assignee?: string;
  search?: string;
  includeSubtasks?: boolean;
}

export async function listTasks(
  request: Request,
  projectKey: string,
  filters: TaskFilters = {},
): Promise<Task[]> {
  const query: Record<string, string | undefined> = {
    status: filters.status === 'ALL' ? undefined : filters.status,
    type: filters.type === 'ALL' ? undefined : filters.type,
    priority: filters.priority === 'ALL' ? undefined : filters.priority,
    assigneeId: filters.assignee === 'ALL' ? undefined : filters.assignee,
    search: filters.search?.trim() || undefined,
    includeSubtasks: filters.includeSubtasks ? 'true' : undefined,
  };

  return callApi<Task[]>(`/projects/${projectKey}/tasks`, { request, query });
}

/**
 * A task, with its subtasks and project already attached.
 *
 * One call rather than three: the API includes them, and three round trips to
 * render one screen is three chances for a slow one.
 */
export async function getTask(request: Request, key: string): Promise<Task> {
  return callApi<Task>(`/tasks/${key}`, { request });
}

export async function listMyTasks(request: Request, workspaceId?: string): Promise<Task[]> {
  return callApi<Task[]>('/tasks/mine', { request, query: { workspaceId } });
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  parentId?: string | null;
}

export async function createTask(
  request: Request,
  projectKey: string,
  input: CreateTaskInput,
): Promise<Task> {
  return callApi<Task>(`/projects/${projectKey}/tasks`, {
    method: 'POST',
    request,
    body: input,
  });
}

export async function updateTask(
  request: Request,
  key: string,
  patch: Partial<Pick<Task, 'title' | 'description' | 'type' | 'priority' | 'clientVisible'>> & {
    assigneeId?: string | null;
    dueDate?: string | null;
    estimateHours?: number | null;
  },
): Promise<Task> {
  return callApi<Task>(`/tasks/${key}`, { method: 'PATCH', request, body: patch });
}

/**
 * Status is its own endpoint, not a field on the general patch.
 *
 * Different permissions (a developer moves their own task but cannot change
 * its due date), different validation (BLOCKED needs a reason), different side
 * effects. Folding it in would put two unrelated sets of rules in one handler.
 */
export async function updateTaskStatus(
  request: Request,
  key: string,
  status: TaskStatus,
  blockedReason?: string,
): Promise<Task> {
  return callApi<Task>(`/tasks/${key}/status`, {
    method: 'PATCH',
    request,
    body: { status, ...(blockedReason ? { blockedReason } : {}) },
  });
}

export async function archiveTask(request: Request, key: string): Promise<void> {
  await callApi(`/tasks/${key}`, { method: 'DELETE', request });
}

/* ── Comments ───────────────────────────────────────────────────────────── */

/**
 * Internal comments are filtered by the API for a client, not here.
 *
 * That is not a detail. Filtering in the web tier would mean the internal
 * comment travelled over the wire to the client's browser and was merely not
 * drawn — visible in the network tab to anyone who looked.
 */
export async function listComments(request: Request, taskKey: string): Promise<Comment[]> {
  return callApi<Comment[]>(`/tasks/${taskKey}/comments`, { request });
}

export async function addComment(
  request: Request,
  taskKey: string,
  body: string,
  isInternal: boolean,
): Promise<Comment> {
  return callApi<Comment>(`/tasks/${taskKey}/comments`, {
    method: 'POST',
    request,
    body: { body, isInternal },
  });
}

/* ── Activity and notifications ─────────────────────────────────────────── */

export async function listActivity(request: Request, projectKey: string): Promise<Activity[]> {
  return callApi<Activity[]>(`/projects/${projectKey}/activity`, { request });
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread: number;
}

export async function listNotifications(request: Request): Promise<NotificationsResponse> {
  return callApi<NotificationsResponse>('/notifications', { request });
}

/**
 * Mark one as read, rather than all of them.
 *
 * Opening a notification should clear that notification. Only "mark all" was
 * wired, so the badge either stayed wrong or you cleared eleven things to deal
 * with one.
 */
export async function markNotificationRead(request: Request, id: string): Promise<void> {
  await callApi(`/notifications/${id}/read`, { method: 'POST', request });
}

export async function markNotificationsRead(request: Request): Promise<void> {
  await callApi('/notifications/read', { method: 'POST', request });
}

/* ── Dashboard ──────────────────────────────────────────────────────────── */

/**
 * Three shapes, discriminated by `role`.
 *
 * The API returns different data per role because the same numbers are not
 * meaningful to all three — a client is never an assignee, so "My Tasks" was
 * permanently zero for them under the old shared shape. The union means a
 * screen rendering `dashboard.blocked` has to narrow to the manager shape
 * first, and TypeScript enforces that.
 */
export interface TaskCard {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  type: TaskType;
  dueDate: string | null;
  assigneeName: string | null;
  projectKey: string;
  blockedReason: string | null;
}

interface DashboardBase {
  workspaceId: string;
  projects: (Project & { progress: number; memberCount: number })[];
  activity: Activity[];
}

export interface ClientDashboard extends DashboardBase {
  role: 'CLIENT';
  totals: { projects: number; completedThisWeek: number; waitingOnYou: number; upcoming: number };
  completedThisWeek: TaskCard[];
  waitingOnYou: TaskCard[];
  upcoming: TaskCard[];
}

export interface ManagerDashboard extends DashboardBase {
  role: 'PROJECT_MANAGER';
  totals: {
    projects: number;
    activeProjects: number;
    blocked: number;
    overdue: number;
    awaitingReview: number;
  };
  blocked: TaskCard[];
  overdue: TaskCard[];
  awaitingReview: TaskCard[];
  workload: { userId: string; name: string; open: number; overdue: number }[];
}

export interface DeveloperDashboard extends DashboardBase {
  role: 'DEVELOPER';
  totals: { projects: number; myTasks: number; overdue: number; inProgress: number };
  myTasks: TaskCard[];
  overdue: TaskCard[];
  inProgress: TaskCard[];
}

export type Dashboard = ClientDashboard | ManagerDashboard | DeveloperDashboard;

export async function getDashboard(request: Request, slug: string): Promise<Dashboard> {
  return callApi<Dashboard>(`/workspaces/${slug}/dashboard`, { request });
}
