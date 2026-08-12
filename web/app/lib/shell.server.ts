import { redirect } from 'react-router';

import {
  getWorkspace,
  listMyTasks,
  listOrganizations,
  listProjects,
  listWorkspaces,
} from '~/data/gateway.server';
import { listNotifications } from '~/data/gateway.server';
import { requireUser } from './session.server';
import { ApiError } from './api.server';
import type { ShellData } from '~/components/layout/AppShell';
import type { Person } from '~/data/types';

/**
 * Everything the frame needs, for any screen inside a workspace.
 *
 * Identity comes from the signed session cookie now — `requireUser` verifies
 * the token, refreshes it when it is close to expiry, and redirects to the
 * login screen when there is nothing valid. The `?as=` role switch that stood
 * in for this while the frontend ran ahead of the API is gone: it was a
 * development affordance, and leaving a way to assume another role in shipped
 * code would be the most serious hole in the product.
 */
export async function getShellData(request: Request, slug: string): Promise<ShellData> {
  const user = await requireUser(request);

  const [workspaces, notifications, organizations] = await Promise.all([
    listWorkspaces(request),
    listNotifications(request),
    // Almost always a single row, and cheap. Fetched on every shell load
    // rather than lazily because the alternative is a switcher that appears a
    // beat after the page, which reads as a glitch.
    listOrganizations(request),
  ]);

  const workspace = await resolveWorkspace(request, slug, workspaces);

  // Both scoped to this workspace, and both already filtered by the API for
  // what this person may see.
  const [projects, myTasks] = await Promise.all([
    listProjects(request, { workspaceId: workspace.id }),
    listMyTasks(request, workspace.id),
  ]);

  return {
    viewer: toPerson(user),
    workspace,
    workspaces,
    organizations,
    projects,
    myTasks,
    canCreateProject: user.role === 'PROJECT_MANAGER',
    unread: notifications.unread,
  };
}

/**
 * Resolves the workspace in the URL, or sends the person somewhere real.
 *
 * A 404 here is ordinary rather than exceptional: a bookmark to a workspace
 * that was renamed, or a client following a link to one that is not theirs.
 * Both should land on a workspace they can actually use, not an error screen.
 */
async function resolveWorkspace(request: Request, slug: string, workspaces: { slug: string }[]) {
  try {
    return await getWorkspace(request, slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      const first = workspaces[0];
      throw redirect(first ? `/w/${first.slug}` : '/workspaces/new');
    }
    throw error;
  }
}

/**
 * The session user, in the shape the sidebar and top bar want.
 *
 * Initials and avatar colour are derived rather than stored: they are a
 * function of the name, and a column for each would be two more things to keep
 * in step when someone changes theirs.
 */
function toPerson(user: {
  id: string;
  name: string;
  email: string;
  role: Person['role'];
}): Person {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
    avatarColor: avatarColor(user.id),
  };
}

/**
 * A stable colour per person, from their id.
 *
 * Deterministic so the same face is the same colour on every screen and every
 * reload. Drawn from the role palette rather than random hex, so an avatar can
 * never land on something unreadable against the surface behind it.
 */
const AVATAR_COLORS = [
  '#4f46e5', '#7c3aed', '#0891b2', '#059669',
  '#c2410c', '#be185d', '#0d9488', '#b45309',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

/** Where a signed-in person should land when they hit `/`. */
export async function defaultWorkspaceSlug(request: Request): Promise<string | null> {
  const workspaces = await listWorkspaces(request);
  return workspaces[0]?.slug ?? null;
}
