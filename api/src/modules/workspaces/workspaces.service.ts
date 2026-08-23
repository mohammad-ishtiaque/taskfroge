import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../middleware/authenticate';
import { Workspace, Project, ProjectMember, IWorkspace } from '../../models';

/* ==========================================================================
   Workspaces — one per client
   ========================================================================== */

async function getReachableWorkspaceIds(auth: AuthContext): Promise<string[] | null> {
  if (auth.role !== 'CLIENT') return null; // Null means all non-archived in org

  const memberRecords = await ProjectMember.find({ userId: auth.userId }).select('projectId');
  const projectIds = memberRecords.map((m) => m.projectId);

  const projects = await Project.find({ _id: { $in: projectIds }, orgId: auth.orgId }).select('workspaceId');
  return Array.from(new Set(projects.map((p) => p.workspaceId.toString())));
}

export type WorkspaceWithCount = IWorkspace & { _count: { projects: number } };

export async function listWorkspaces(auth: AuthContext): Promise<WorkspaceWithCount[]> {
  const allowedIds = await getReachableWorkspaceIds(auth);
  const query: any = { orgId: auth.orgId, archivedAt: null };
  if (allowedIds !== null) {
    query._id = { $in: allowedIds };
  }

  const workspaces = await Workspace.find(query).sort({ name: 1 });

  return Promise.all(
    workspaces.map(async (w) => {
      const obj = w.toJSON() as unknown as WorkspaceWithCount;
      const count = await Project.countDocuments({ workspaceId: w.id, archivedAt: null });
      obj._count = { projects: count };
      return obj;
    })
  );
}

export async function getWorkspaceBySlug(
  auth: AuthContext,
  slug: string
): Promise<WorkspaceWithCount> {
  const allowedIds = await getReachableWorkspaceIds(auth);
  const query: any = { orgId: auth.orgId, slug, archivedAt: null };
  if (allowedIds !== null) {
    query._id = { $in: allowedIds };
  }

  const workspace = await Workspace.findOne(query);

  if (!workspace) throw AppError.notFound('Workspace');

  const obj = workspace.toJSON() as unknown as WorkspaceWithCount;
  const count = await Project.countDocuments({ workspaceId: workspace.id, archivedAt: null });
  obj._count = { projects: count };

  return obj;
}

export async function createWorkspace(
  auth: AuthContext,
  input: { name: string; clientName: string }
): Promise<IWorkspace> {
  if (auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('Only a project manager can create a workspace');
  }

  const slug = await uniqueSlug(auth.orgId, input.name);

  const workspace = await Workspace.create({
    orgId: auth.orgId,
    slug,
    name: input.name,
    clientName: input.clientName,
  });

  logger.info({ workspaceId: workspace.id, slug, by: auth.userId }, 'Workspace created');
  return workspace.toJSON();
}

export async function updateWorkspace(
  auth: AuthContext,
  slug: string,
  input: { name?: string; clientName?: string }
): Promise<IWorkspace> {
  if (auth.role !== 'PROJECT_MANAGER') {
    throw AppError.forbidden('Only a project manager can change a workspace');
  }

  const workspace = await getWorkspaceBySlug(auth, slug);

  const updateData: any = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.clientName !== undefined) updateData.clientName = input.clientName;

  const updated = await Workspace.findByIdAndUpdate(workspace.id, updateData, { new: true });
  if (!updated) throw AppError.notFound('Workspace');

  return updated.toJSON();
}

async function uniqueSlug(orgId: string, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';

  const taken = await Workspace.find({
    orgId,
    slug: new RegExp(`^${base}`),
  }).select('slug');

  const used = new Set(taken.map((w) => w.slug));
  if (!used.has(base)) return base;

  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }

  throw AppError.conflict('Could not derive a unique workspace address');
}
