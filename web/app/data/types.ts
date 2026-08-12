/* ==========================================================================
   Domain types — the contract between screens and data
   --------------------------------------------------------------------------
   These describe what a screen receives, and they are deliberately written
   before either the mock data or the API endpoints that will satisfy them.

   Why this file exists at all: we are building the whole frontend before the
   backend catches up. The usual way that goes wrong is that screens get built
   against whatever shape was convenient that afternoon, and wiring the real
   API later turns into rewriting every screen. So the shapes are fixed here
   once, the mock store implements them, and the API will be built to match.

   Rules held to throughout:
   - Dates cross this boundary as ISO strings, never Date objects. They survive
     serialisation from a loader and there is exactly one place that formats
     them for display.
   - Nothing here is optional out of laziness. `null` means "genuinely absent";
     `?` means "the caller may not have asked for it".
   - A field a client must never see is not marked with a flag here. It is
     absent from the type the client's screen is given. See ClientTask.
   ========================================================================== */

export type Role = 'CLIENT' | 'PROJECT_MANAGER' | 'DEVELOPER';

export type ProjectStatus =
  | 'PLANNING'
  | 'ACTIVE'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * Five statuses, in board order. The order is the tuple order — the board
 * renders columns by iterating this, so there is no second list to keep in
 * step with it.
 */
export const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'DONE',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = ['TASK', 'BUG', 'STORY', 'CHORE'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];

export type VisibilityPreset = 'OPEN' | 'SUMMARY' | 'CUSTOM';

/* ── People ─────────────────────────────────────────────────────────────── */

export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Initials are derived once, server-side, so 30 avatars do not each do it. */
  initials: string;
  avatarColor: string;
}

/* ── Workspace ──────────────────────────────────────────────────────────
   One workspace per client, as decided. A client belongs to exactly one and
   can never see another, which makes the strongest isolation rule in the
   product a structural one rather than a filter someone has to remember.   */

export interface Workspace {
  id: string;
  /** URL segment. Stable — renaming a workspace must not break saved links. */
  slug: string;
  name: string;
  clientName: string;
  memberCount: number;
  projectCount: number;
}

/**
 * An account, not a workspace — a distinction that only matters to the handful
 * of people who have two.
 *
 * A workspace groups projects inside one organisation. An organisation is the
 * account itself, and `role` belongs to the membership rather than the person:
 * somebody can run their own workspace as a project manager and appear in
 * yours as a developer. The sidebar switcher is the only place this surfaces.
 */
export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  role: Person['role'];
  current: boolean;
}

/* ── Projects ───────────────────────────────────────────────────────────── */

export interface ProjectVisibility {
  preset: VisibilityPreset;
  showBoard: boolean;
  showAssignees: boolean;
  showDueDates: boolean;
  /** Off even under OPEN. Commercially sensitive — see docs/04 §3. */
  showTimeTracking: boolean;
  showBlockedReasons: boolean;
  showAttachments: boolean;
}

export interface Project {
  id: string;
  workspaceId: string;
  /** `WEB`. Uppercase letters only; task keys are built from it. */
  key: string;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  startDate: string | null;
  endDate: string | null;
  leadId: string | null;
  /** ISO, or null for a live project. Archived is not deleted — the tasks,
      comments and logged hours all stay, because an agency needs last year's
      work to answer what it billed for. */
  archivedAt: string | null;
  memberIds: string[];
  /** 0–100, derived from task completion rather than typed in by a human. */
  progress: number;
  visibility: ProjectVisibility;
  /** Present on the dashboard payload, which precomputes it. */
  memberCount?: number;
  members?: Person[];
  /**
   * Outstanding invitations. Only the detail endpoint sends them, and only the
   * live ones — accepted, revoked and expired rows are filtered out in the
   * query, so anything here is still clickable by whoever received it.
   */
  invitations?: Invitation[];
}

export interface Invitation {
  id: string;
  email: string;
  role: Person['role'];
  /** ISO. Seven days from when it was sent. */
  expiresAt: string;
  createdAt: string;
}

export interface ProjectStats {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  teamSize: number;
  completionRate: number;
  byStatus: Record<TaskStatus, number>;
  byType: Record<TaskType, number>;
  byPriority: Record<Priority, number>;
}

/* ── Tasks ──────────────────────────────────────────────────────────────── */

export interface Task {
  id: string;
  /** `WEB-142`. What people say out loud, so it is the thing shown biggest. */
  key: string;
  projectId: string;
  parentId: string | null;
  title: string;
  /** Markdown. Rendered sanitised — never injected as HTML. */
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  reporterId: string;
  dueDate: string | null;
  estimateHours: number | null;
  loggedHours: number;
  /** Required whenever status is BLOCKED, and only meaningful then. */
  blockedReason: string | null;
  /** Inherits the project default at creation; overridable per task. */
  clientVisible: boolean;
  labels: string[];
  createdAt: string;
  updatedAt: string;

  /* ── Included relations ────────────────────────────────────────────────
     Optional because whether they arrive depends on the endpoint: the task
     list includes the assignee, the detail endpoint also includes subtasks and
     the project. Marking them optional is honest — a screen has to handle the
     case where it asked for the cheap shape. */
  assignee?: Person | null;
  reporter?: Person | null;
  subtasks?: Task[];
  // `workspaceId` is carried so a task can be linked to without a second
  // lookup — the `/t/:key` short link a push notification points at resolves
  // the workspace from it.
  project?: Pick<Project, 'id' | 'key' | 'name' | 'workspaceId' | 'visibility'>;
  _count?: { subtasks: number };
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  /**
   * The single most important boolean in the product. An internal comment is
   * filtered out server-side for a client; it is never merely hidden by CSS.
   */
  isInternal: boolean;
  createdAt: string;
  author?: Person;
}

export type ActivityKind =
  | 'TASK_CREATED'
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'COMMENTED'
  | 'DUE_DATE_CHANGED'
  | 'BLOCKED'
  | 'UNBLOCKED'
  | 'VISIBILITY_CHANGED';

export interface Activity {
  id: string;
  projectId: string;
  taskId: string | null;
  actorId: string;
  kind: ActivityKind;
  /**
   * Values for the translated sentence, not a pre-built English string. An
   * activity feed written as prose on the server cannot be translated.
   */
  detail: Record<string, string>;
  createdAt: string;
  /** Excluded from a client's feed when false. */
  clientVisible: boolean;
  actor?: Pick<Person, 'id' | 'name' | 'avatarColor'>;
  task?: Pick<Task, 'key' | 'title'>;
}

export interface Notification {
  id: string;
  actor?: Pick<Person, 'id' | 'name'> | null;
  recipientId: string;
  kind:
    | 'ASSIGNED'
    | 'MENTIONED'
    | 'STATUS_CHANGED'
    | 'DUE_SOON'
    | 'OVERDUE'
    | 'COMMENT';
  taskKey: string;
  taskTitle: string;
  projectKey: string;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ── The client's view ──────────────────────────────────────────────────
   A separate type, not `Partial<Task>`.

   With Partial, forgetting to redact a field is a runtime bug that ships. With
   a distinct type, handing a client screen an unredacted Task is a compile
   error. The visibility rules in docs/04 are worth a type of their own.       */

export interface ClientTask {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  /** Present only when showAssignees. */
  assigneeName: string | null;
  /** Present only when showDueDates. */
  dueDate: string | null;
  /** Present only when showBlockedReasons and the task is blocked. */
  blockedReason: string | null;
}

/* ── Helpers used across screens ────────────────────────────────────────── */

/** Statuses that mean "not finished", for counting active work. */
export const OPEN_STATUSES: readonly TaskStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
];

export function isOverdue(task: Pick<Task, 'dueDate' | 'status'>, now = new Date()): boolean {
  if (!task.dueDate || task.status === 'DONE') return false;
  return new Date(task.dueDate) < now;
}
