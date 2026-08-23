import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { withTransaction } from '../../lib/db';
import {
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
import {
  Project,
  ProjectMember,
  ProjectVisibility,
  Invitation,
  Task,
  User,
  Membership,
  Workspace,
  Role,
  UserDocument,
} from '../../models';

/**
 * What a caller is allowed to see.
 */
async function visibleProjectsQuery(auth: AuthContext): Promise<any> {
  if (auth.role === 'PROJECT_MANAGER') {
    return { orgId: auth.orgId };
  }
  const memberRecords = await ProjectMember.find({ userId: auth.userId }).select('projectId');
  const projectIds = memberRecords.map((m) => m.projectId);
  return { orgId: auth.orgId, _id: { $in: projectIds } };
}

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
  const baseQuery = await visibleProjectsQuery(auth);
  const query: any = {
    ...baseQuery,
    ...(includeArchived ? {} : { archivedAt: null }),
    ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
  };

  if (filters.search) {
    const searchRegex = new RegExp(filters.search, 'i');
    query.$or = [
      { name: searchRegex },
      { key: filters.search.toUpperCase() },
      { description: searchRegex },
    ];
  }

  const projects = await Project.find(query).sort({ status: 1, name: 1 });

  const populated = await Promise.all(
    projects.map((p) => hydrateProject(p))
  );

  return toProjects(populated);
}

async function hydrateProject(projectDoc: any) {
  const project = projectDoc.toJSON();
  const [visibility, members, tasks] = await Promise.all([
    ProjectVisibility.findOne({ projectId: project.id }),
    ProjectMember.find({ projectId: project.id }).select('userId'),
    Task.find({ projectId: project.id, archivedAt: null }).select('status parentId'),
  ]);

  return {
    ...project,
    visibility: visibility ? visibility.toJSON() : null,
    members: members.map((m) => ({ userId: m.userId.toString() })),
    tasks: tasks.map((t) => t.toJSON()),
  };
}

export async function listProjectMembers(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  const members = await ProjectMember.find({ projectId }).populate<{ userId: UserDocument }>('userId');

  const usersWithRole = await Promise.all(
    members.map(async (m) => {
      const u = m.userId;
      if (!u) return null;
      const membership = await Membership.findOne({ orgId: auth.orgId, userId: u.id }).select('role');
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        memberships: membership ? [{ role: membership.role }] : [],
      };
    })
  );

  return toPeople(usersWithRole.filter(Boolean));
}

export async function getProject(auth: AuthContext, idOrKey: string) {
  const baseQuery = await visibleProjectsQuery(auth);
  const query: any = {
    ...baseQuery,
    ...(isIdLike(idOrKey) ? { _id: idOrKey } : { key: idOrKey.toUpperCase() }),
  };

  const projectDoc = await Project.findOne(query);
  if (!projectDoc) throw AppError.notFound('Project');

  const hydrated = await hydrateProject(projectDoc);

  const members = await ProjectMember.find({ projectId: projectDoc.id }).populate<{ userId: UserDocument }>('userId');
  const membersWithRole = await Promise.all(
    members.map(async (m) => {
      const u = m.userId;
      if (!u) return null;
      const membership = await Membership.findOne({ orgId: auth.orgId, userId: u.id }).select('role');
      return {
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatarUrl,
          memberships: membership ? [{ role: membership.role }] : [],
        },
      };
    })
  );

  const invitations = await Invitation.find({
    projectId: projectDoc.id,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('id email role expiresAt createdAt');

  return {
    ...toProject(hydrated),
    members: toPeople(membersWithRole.filter(Boolean).map((m) => m!.user)),
    invitations: invitations.map((i) => i.toJSON()),
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

  const workspace = await Workspace.findOne({
    _id: input.workspaceId,
    orgId: auth.orgId,
    archivedAt: null,
  });

  if (!workspace) throw AppError.notFound('Workspace');

  try {
    const createdProject = await withTransaction(async (session) => {
      const [p] = await Project.create(
        [
          {
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
          },
        ],
        { session }
      );
      if (!p) throw AppError.internal('Failed to create project document');

      const uniqueMemberIds = Array.from(new Set([auth.userId, ...(input.memberIds ?? [])]));
      await ProjectMember.create(
        uniqueMemberIds.map((userId) => ({ projectId: p.id, userId })),
        { session }
      );

      await ProjectVisibility.create(
        [
          {
            projectId: p.id,
            preset,
            ...toggles,
            updatedById: auth.userId,
          },
        ],
        { session }
      );

      return p;
    });

    if (!createdProject) throw AppError.internal('Failed to create project');

    logger.info(
      { projectId: createdProject.id, key: createdProject.key, orgId: auth.orgId },
      'Project created',
    );

    const hydrated = await hydrateProject(createdProject);
    return toProject(hydrated);
  } catch (error: any) {
    if (error?.code === 11000) {
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

  const updated = await Project.findByIdAndUpdate(
    projectId,
    { name: input.name, description: input.description },
    { new: true }
  );
  if (!updated) throw AppError.notFound('Project');
  return updated.toJSON();
}

export async function archiveProject(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  const project = await Project.findByIdAndUpdate(
    projectId,
    { archivedAt: new Date() },
    { new: true }
  );

  if (!project) throw AppError.notFound('Project');
  logger.info({ projectId, actor: auth.userId }, 'Project archived');
  return project.toJSON();
}

export async function restoreProject(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  const project = await Project.findByIdAndUpdate(
    projectId,
    { archivedAt: null },
    { new: true }
  );

  if (!project) throw AppError.notFound('Project');
  return project.toJSON();
}

export async function updateVisibility(
  auth: AuthContext,
  projectId: string,
  input: VisibilityInput,
) {
  await assertProjectInOrg(auth, projectId);

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

  const result = await ProjectVisibility.findOneAndUpdate(
    { projectId },
    { preset: input.preset, ...toggles, updatedById: auth.userId },
    { upsert: true, new: true }
  );

  logger.info(
    { projectId, preset: input.preset, actor: auth.userId },
    'Client visibility changed',
  );

  return result.toJSON();
}

export async function addMember(auth: AuthContext, projectId: string, userId: string) {
  await assertProjectInOrg(auth, projectId);

  const membership = await Membership.findOne({ orgId: auth.orgId, userId }).select('status');

  if (!membership || membership.status !== 'ACTIVE') {
    throw AppError.notFound('User in this organisation');
  }

  try {
    const member = await ProjectMember.create({ projectId, userId });
    const user = await User.findById(userId).select('id name email avatarUrl');
    return {
      id: member.id,
      addedAt: member.addedAt,
      user: user ? user.toJSON() : null,
    };
  } catch (error: any) {
    if (error?.code === 11000) {
      throw AppError.conflict('That person is already on this project');
    }
    throw error;
  }
}

export async function removeMember(auth: AuthContext, projectId: string, userId: string) {
  await assertProjectInOrg(auth, projectId);

  const allMembers = await ProjectMember.find({ projectId });
  const otherMemberUserIds = allMembers.map((m) => m.userId.toString()).filter((id) => id !== userId);

  const pmMemberships = await Membership.find({
    orgId: auth.orgId,
    userId: { $in: otherMemberUserIds },
    role: 'PROJECT_MANAGER',
    status: 'ACTIVE',
  });

  const remainingManagers = pmMemberships.length;

  const targetMembership = await Membership.findOne({
    orgId: auth.orgId,
    userId,
    status: 'ACTIVE',
  }).select('role');

  if (!allMembers.some((m) => m.userId.toString() === userId)) {
    throw AppError.notFound('Project member');
  }

  if (targetMembership?.role === 'PROJECT_MANAGER' && remainingManagers === 0) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      status: 422,
      message: 'A project needs at least one project manager',
    });
  }

  await ProjectMember.deleteOne({ projectId, userId });
}

export async function listAssignableUsers(auth: AuthContext, projectId: string) {
  await assertProjectInOrg(auth, projectId);

  const currentProjectMembers = await ProjectMember.find({ projectId }).select('userId');
  const excludedUserIds = currentProjectMembers.map((m) => m.userId.toString());

  const activeMemberships = await Membership.find({
    orgId: auth.orgId,
    status: 'ACTIVE',
    userId: { $nin: excludedUserIds },
  });

  const activeUserIds = activeMemberships.map((m) => m.userId);

  const users = await User.find({ _id: { $in: activeUserIds }, isActive: true }).sort({ name: 1 });

  const result = users.map((u) => {
    const mem = activeMemberships.find((m) => m.userId.toString() === u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      memberships: mem ? [{ role: mem.role }] : [],
    };
  });

  return toPeople(result);
}

async function assertProjectInOrg(auth: AuthContext, projectId: string): Promise<void> {
  const found = await Project.findOne({ _id: projectId, orgId: auth.orgId }).select('id');
  if (!found) throw AppError.notFound('Project');
}

export async function resolveProjectId(auth: AuthContext, idOrKey: string): Promise<string> {
  if (isIdLike(idOrKey)) return idOrKey;

  const project = await Project.findOne({
    orgId: auth.orgId,
    key: idOrKey.toUpperCase(),
  }).select('id');

  if (!project) throw AppError.notFound('Project');
  return project.id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONGO_ID = /^[0-9a-fA-F]{24}$/;
function isIdLike(value: string): boolean {
  return UUID.test(value) || MONGO_ID.test(value);
}

export type { Role };
