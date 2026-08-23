/* ==========================================================================
   Response shapes
   --------------------------------------------------------------------------
   One place that decides what a Person and a Project look like on the wire.

   This file exists because of a bug rather than a principle. Each endpoint
   picked its own `select`, so `/projects` returned `_count.members` while the
   web app expected `memberIds`, and `/assignable` returned a nested
   `memberships[0].role` where the UI wanted a flat `role`. Both typechecked —
   the web tier had its own idea of the shape and nothing compared the two —
   and both crashed on the first real click.

   The rule now: an endpoint returning a person or a project returns *this*
   shape. If a screen needs another field, it is added here and every endpoint
   gains it at once.
   ========================================================================== */

import type { Role } from '../models';

export interface PersonDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Derived, not stored — a function of the name, so two columns would be
      two things to keep in step when someone changes theirs. */
  initials: string;
  avatarColor: string;
}

/** Drawn from a fixed palette so an avatar can never land on something
    unreadable against the surface behind it. Deterministic from the id, so
    one face is one colour on every screen and every reload. */
const AVATAR_COLORS = [
  '#4f46e5', '#7c3aed', '#0891b2', '#059669',
  '#c2410c', '#be185d', '#0d9488', '#b45309',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function initialsOf(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A person, from any query that loaded one.
 *
 * Accepts either a flat `role` or the nested `memberships[0].role` that a
 * Prisma include produces, because both spellings exist across the codebase
 * and the caller should not have to care which one they have.
 */
export function toPerson(user: any): PersonDto {
  const role: Role = user.role ?? user.memberships?.[0]?.role ?? 'DEVELOPER';

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    initials: initialsOf(user.name ?? ''),
    avatarColor: avatarColor(user.id),
  };
}

export function toPeople(users: any[]): PersonDto[] {
  return users.map(toPerson);
}

export interface ProjectDto {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  leadId: string | null;
  /** ISO, or null for a live project. Archived keeps every task and hour. */
  archivedAt: string | null;
  memberIds: string[];
  memberCount: number;
  /** 0–100, from completed parent tasks. Computed here so every screen
      showing a progress bar agrees on what progress means. */
  progress: number;
  visibility: {
    preset: string;
    showBoard: boolean;
    showAssignees: boolean;
    showDueDates: boolean;
    showTimeTracking: boolean;
    showBlockedReasons: boolean;
    showAttachments: boolean;
  };
}

/** Sent when a project has no visibility row yet — the safest reading of
    "not configured", not the most permissive. */
const DEFAULT_VISIBILITY = {
  preset: 'OPEN',
  showBoard: true,
  showAssignees: true,
  showDueDates: true,
  showTimeTracking: false,
  showBlockedReasons: true,
  showAttachments: true,
};

export function toProject(project: any): ProjectDto {
  const members: { userId: string }[] = project.members ?? [];
  const tasks: { status: string; parentId: string | null }[] = project.tasks ?? [];

  // Parent tasks only. Counting subtasks would let a task split into ten
  // pieces move the bar ten times as far as one that was not.
  const parents = tasks.filter((t) => !t.parentId);
  const done = parents.filter((t) => t.status === 'DONE').length;

  return {
    id: project.id,
    workspaceId: project.workspaceId,
    key: project.key,
    name: project.name,
    description: project.description ?? '',
    status: project.status,
    priority: project.priority,
    startDate: project.startDate ? new Date(project.startDate).toISOString() : null,
    endDate: project.endDate ? new Date(project.endDate).toISOString() : null,
    leadId: project.leadId ?? null,
    archivedAt: project.archivedAt ? new Date(project.archivedAt).toISOString() : null,
    memberIds: members.map((m) => m.userId),
    memberCount: members.length || project._count?.members || 0,
    progress: parents.length === 0 ? 0 : Math.round((done / parents.length) * 100),
    visibility: project.visibility ?? DEFAULT_VISIBILITY,
  };
}

export function toProjects(projects: any[]): ProjectDto[] {
  return projects.map(toProject);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A task, with any people on it serialised.
 *
 * Decimal columns come back from Prisma as Decimal objects, which serialise to
 * a string over JSON — so `estimateHours` arrived as "16" where the screen
 * expected 16, and any arithmetic on it silently concatenated.
 */
export function toTask(task: any): Record<string, unknown> {
  if (!task) return task;

  return {
    ...task,
    estimateHours: task.estimateHours === null || task.estimateHours === undefined
      ? null
      : Number(task.estimateHours),
    loggedHours: Number(task.loggedHours ?? 0),
    assignee: task.assignee ? toPerson(task.assignee) : null,
    reporter: task.reporter ? toPerson(task.reporter) : null,
    ...(task.subtasks ? { subtasks: task.subtasks.map(toTask) } : {}),
    ...(task.project ? { project: toProject(task.project) } : {}),
  };
}

export function toTasks(tasks: any[]): Record<string, unknown>[] {
  return tasks.map(toTask);
}

export function toComment(comment: any): Record<string, unknown> {
  if (!comment) return comment;
  return { ...comment, author: comment.author ? toPerson(comment.author) : null };
}

export function toComments(comments: any[]): Record<string, unknown>[] {
  return comments.map(toComment);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * What a person query must select for `toPerson` to produce a full DTO.
 *
 * `memberships` carries the role. Selecting the user without it yields a
 * person whose role silently falls back to DEVELOPER.
 */
export const personSelect = (orgId: string) =>
  ({
    id: true,
    name: true,
    email: true,
    memberships: { where: { orgId }, select: { role: true } },
  }) as const;

/** What every project query must load for `toProject` to be complete. */
export const PROJECT_INCLUDE = {
  visibility: true,
  members: { select: { userId: true } },
  tasks: { where: { archivedAt: null }, select: { status: true, parentId: true } },
} as const;
