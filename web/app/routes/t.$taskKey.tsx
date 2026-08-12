import { redirect } from 'react-router';

import type { Route } from './+types/t.$taskKey';
import { getTask, listWorkspaces } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';

/**
 * Short link to a task: `/t/WEB-14`.
 *
 * Exists because a push notification is built by the API, which knows the task
 * key and not the workspace slug. Resolving it there would mean a project and
 * workspace lookup on every push — per recipient, per notification — for a
 * value this tier can work out on the one occasion someone actually taps it.
 *
 * Signed out, `requireUser` sends them to sign in with `redirectTo` set, so
 * tapping a notification on a phone that has been logged out lands on the task
 * rather than on a dashboard.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);

  const key = params.taskKey!.toUpperCase();

  // Both go through the API, so a task the caller may not see is a 404 here
  // exactly as it is everywhere else. Nothing about this route widens access;
  // it only saves the sender a lookup.
  const [task, workspaces] = await Promise.all([getTask(request, key), listWorkspaces(request)]);

  const workspaceId = task.project?.workspaceId;
  const slug = workspaces.find((w) => w.id === workspaceId)?.slug ?? workspaces[0]?.slug;

  if (!slug) throw new Response('Not Found', { status: 404 });

  return redirect(`/w/${slug}/tasks/${key}`);
}
