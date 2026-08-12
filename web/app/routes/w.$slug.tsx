import { Outlet } from 'react-router';

import type { Route } from './+types/w.$slug';
import { AppShell } from '~/components/layout/AppShell';
import { getShellData } from '~/lib/shell.server';

/**
 * The layout route for everything inside a workspace.
 *
 * Every screen under `/w/:slug` renders through here, so the sidebar and top
 * bar are loaded once per navigation rather than once per screen. It also
 * means a new screen gets the frame by existing, which removes a whole class
 * of "I built the page but it has no navigation" mistake.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return getShellData(request, params.slug!);
}

export default function WorkspaceLayout({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell data={loaderData}>
      <Outlet />
    </AppShell>
  );
}
