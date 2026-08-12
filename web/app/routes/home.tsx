import { redirect } from 'react-router';

import type { Route } from './+types/home';
import { getUser } from '~/lib/session.server';
import { defaultWorkspaceSlug } from '~/lib/shell.server';

/**
 * `/` is a signpost, never a screen.
 *
 * Signed out goes to login. Signed in goes to the first workspace — and if
 * there is not one yet, to the screen that creates it, because a project
 * manager with no workspace has exactly one useful next action.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  if (!user) return redirect('/login');

  const slug = await defaultWorkspaceSlug(request);
  return redirect(slug ? `/w/${slug}` : '/workspaces/new');
}
