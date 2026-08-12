import { Prisma, type Role } from '@prisma/client';
import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import {
  PROJECT_INCLUDE,
  toPeople,
  toProject,
  toProjects,
  type ProjectDto,
} from '../../lib/serialize';
import type { AuthContext } from '../../middleware/authenticate';
import {
  togglesForPreset,
  type CreateProjectInput,
  type UpdateProjectInput,
  type VisibilityInput,
} from './project.schema';

/**
 * What a caller is allowed to see.
 *
 * A project manager sees every project in the organisation — they are the ones
 * who create and staff them. Developers and clients see only projects they have
 * been added to. This is a *query* filter, not a UI filter: a project you are
 * not on is absent from the response, not hidden in it.
 */
function visibleProjectsWhere(auth: AuthContext): Prisma.ProjectWhereInput {
  if (auth.role === 'PROJECT_MANAGER') {
    return { orgId: auth.orgId };
  }
  return { orgId: auth.orgId, members: { some: { userId: auth.userId } } };
}

const MEMBER_SELECT = {
  id: true,
  addedAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.ProjectMemberSelect;

export interface ListProjectFilters {
  workspaceId?: string;
  status?: string;
  priority?: string;
  search?: string;
}

export async function listProjects(
  auth: AuthContext,
  filters: ListProjectFilters = {},
  includeArchived = false,
) {
  const projects = await prisma.project.findMany({
    where: {
      ...visibleProjectsWhere(auth),
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.priority ? { priority: filters.priority as never } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' as const } },
              { key: { contains: filters.search.toUpperCase() } },
              { description: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: PROJECT_INCLUDE,
  });

  return toProjects(projects);
}

/**
 * Who is on this project.
 *
 * Distinct from `listAssignableUsers`, which returns people *not* yet on it —
 * the "add someone" list. Conflating the two is how the team page ended up
 * showing everyone except the team.
 */
export async function listProjectMembers(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          memberships: { where: { orgId: auth.orgId }, select: { role: true } },
        },
      },
    },
  });

  return toPeople(members.map((m) => m.user));
}

export async function getProject(auth: AuthContext, idOrKey: string) {
  const project = await prisma.project.findFirst({
    where: {
      ...visibleProjectsWhere(auth),
      // Accept either the uuid or the human key, so /projects/WEB works.
      ...(isUuid(idOrKey) ? { id: idOrKey } : { key: idOrKey.toUpperCase() }),
    },
    include: {
      visibility: true,
      tasks: { where: { archivedAt: null }, select: { status: true, parentId: true } },
      members: { select: MEMBER_SELECT, orderBy: { addedAt: 'asc' } },
      invitations: {
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      },
    },
  });

  // 404 rather than 403 for a project you are not on. A 403 would confirm it
  // exists, which is information a client on another project should not get.
  if (!project) throw AppError.notFound('Project');

  // The serialised shape, plus the two extras only the detail screen wants.
  // Everything a screen reads about a project comes from `toProject`, so no
  // endpoint can quietly return a different set of fields.
  return {
    ...toProject(project),
    members: toPeople(project.members.map((m: { user: unknown }) => m.user)),
    invitations: project.invitations,
  };
}

export async function createProject(
  auth: AuthContext,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  const preset = input.visibility?.preset ?? 'OPEN';
  const toggles =
    input.visibility && preset === 'CUSTOM'
      ? {
          showBoard: input.visibility.showBoard,
          showAssignees: input.visibility.showAssignees,
          showDueDates: input.visibility.showDueDates,
          showTimeTracking: input.visibility.showTimeTracking,
          showBlockedReasons: input.visibility.showBlockedReasons,
          showAttachments: input.visibility.showAttachments,
        }
      : togglesForPreset(preset);

  const workspace = await prisma.workspace.findFirst({
    where: { id: input.workspaceId, orgId: auth.orgId, archivedAt: null },
  });

  if (!workspace) throw AppError.notFound('Workspace');

  try {
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          orgId: auth.orgId,
          workspaceId: workspace.id,
          key: input.key,
          name: input.name,
          description: input.description,
          status: input.status ?? 'PLANNING',
          priority: input.priority ?? 'MEDIUM',
          startDate: input.startDate ? new Date(input.startDate) : null,
          endDate: input.endDate ? new Date(input.endDate) : null,
          leadId: input.leadId ?? null,
          createdById: auth.userId,
          // The creator is a member from the start. A project whose own PM has
          // to add themselves is a bad first thirty seconds.
          members: {
            create: Array.from(new Set([auth.userId, ...(input.memberIds ?? [])])).map(
              (userId) => ({ userId }),
            ),
          },
          visibility: {
            create: { preset, ...toggles, updatedById: auth.userId },
          },
        },
      });

      // Re-read through the shared include so the caller gets the same shape
      // every other project endpoint returns. Without this, the object handed
      // back from a create is missing memberIds, progress and visibility —
      // present everywhere else, absent exactly once.
      return tx.project.findUniqueOrThrow({
        where: { id: created.id },
        include: PROJECT_INCLUDE,
      });
    });

    logger.info(
      { projectId: project.id, key: project.key, orgId: auth.orgId },
      'Project created',
    );

    return toProject(project);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw AppError.conflict(`The key "${input.key}" is already used by another project`, {
        fields: ['key'],
      });
    }
    throw error;
  }
}

export async function updateProject(
  auth: AuthContext,
  projectId: string,
  input: UpdateProjectInput,
) {
  await assertProjectInOrg(auth, projectId);

  return prisma.project.update({
    where: { id: projectId },
    data: { name: input.name, description: input.description },
  });
}

/**
 * Archive, never delete.
 *
 * A deleted project would take its tasks, comments and time logs with it, and
 * "where did that work go?" is not a question anyone should have to answer.
 */
export async function archiveProject(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  const project = await prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: new Date() },
  });

  logger.info({ projectId, actor: auth.userId }, 'Project archived');
  return project;
}

export async function restoreProject(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  return prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: null },
  });
}

export async function updateVisibility(
  auth: AuthContext,
  projectId: string,
  input: VisibilityInput,
) {
  await assertProjectInOrg(auth, projectId);

  // A preset overwrites the toggles; CUSTOM keeps whatever was sent. This is
  // why the columns are stored rather than derived — switching preset and back
  // does not silently discard the PM's custom choices in between.
  const toggles =
    input.preset === 'CUSTOM'
      ? {
          showBoard: input.showBoard,
          showAssignees: input.showAssignees,
          showDueDates: input.showDueDates,
          showTimeTracking: input.showTimeTracking,
          showBlockedReasons: input.showBlockedReasons,
          showAttachments: input.showAttachments,
        }
      : togglesForPreset(input.preset);

  const result = await prisma.projectVisibility.upsert({
    where: { projectId },
    update: { preset: input.preset, ...toggles, updatedById: auth.userId },
    create: { projectId, preset: input.preset, ...toggles, updatedById: auth.userId },
  });

  logger.info(
    { projectId, preset: input.preset, actor: auth.userId },
    'Client visibility changed',
  );

  return result;
}

export async function addMember(auth: AuthContext, projectId: string, userId: string) {
  await assertProjectInOrg(auth, projectId);

  // Must already be in the organisation. Adding someone who is not is what
  // invitations are for.
  const membership = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId: auth.orgId, userId } },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    throw AppError.notFound('User in this organisation');
  }

  try {
    return await prisma.projectMember.create({
      data: { projectId, userId },
      select: MEMBER_SELECT,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw AppError.conflict('That person is already on this project');
    }
    throw error;
  }
}

export async function removeMember(auth: AuthContext, projectId: string, userId: string) {
  await assertProjectInOrg(auth, projectId);

  const remainingManagers = await prisma.projectMember.count({
    where: {
      projectId,
      userId: { not: userId },
      user: { memberships: { some: { orgId: auth.orgId, role: 'PROJECT_MANAGER' } } },
    },
  });

  const target = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { user: { select: { memberships: { where: { orgId: auth.orgId }, select: { role: true } } } } },
  });

  if (!target) throw AppError.notFound('Project member');

  // Removing the last project manager would leave a project nobody can
  // administer — including nobody able to add a manager back.
  const targetRole = target.user.memberships[0]?.role;
  if (targetRole === 'PROJECT_MANAGER' && remainingManagers === 0) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      status: 422,
      message: 'A project needs at least one project manager',
    });
  }

  await prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId } } });
}

/** People in the organisation who are not yet on this project. */
export async function listAssignableUsers(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      memberships: { some: { orgId: auth.orgId, status: 'ACTIVE' } },
      projectMembers: { none: { projectId } },
    },
    select: {
      id: true,
      name: true,
      email: true,
      memberships: { where: { orgId: auth.orgId }, select: { role: true } },
    },
    orderBy: { name: 'asc' },
  });

  return toPeople(users);
}

// ── internals ───────────────────────────────────────────────────────────────

/**
 * Confirms the project exists inside the caller's organisation.
 *
 * Every write goes through this. Without it, a project manager at one agency
 * could edit another agency's project by guessing an id — the role gate would
 * happily let them, because they *are* a project manager.
 */
async function assertProjectInOrg(auth: AuthContext, projectId: string): Promise<void> {
  const found = await prisma.project.findFirst({
    where: { id: projectId, orgId: auth.orgId },
    select: { id: true },
  });

  if (!found) throw AppError.notFound('Project');
}

export async function resolveProjectId(auth: AuthContext, idOrKey: string): Promise<string> {
  if (isUuid(idOrKey)) return idOrKey;

  const project = await prisma.project.findUnique({
    where: { orgId_key: { orgId: auth.orgId, key: idOrKey.toUpperCase() } },
    select: { id: true },
  });

  if (!project) throw AppError.notFound('Project');
  return project.id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID.test(value);
}

export type { Role };
