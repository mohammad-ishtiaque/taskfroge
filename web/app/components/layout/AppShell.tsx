import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Sidebar, type SidebarData } from './Sidebar';
import { Topbar } from './Topbar';
import type { Person } from '~/data/types';

export interface ShellData extends SidebarData {
  viewer: Person;
  unread: number;
}

/**
 * The frame every signed-in screen sits inside.
 *
 * On a narrow screen the sidebar becomes a drawer. It closes on navigation —
 * `onNavigate` is threaded down for exactly that — because a drawer that stays
 * open over the page you just navigated to is the most common way this pattern
 * is got wrong.
 */
export function AppShell({
  data,
  children,
}: {
  data: ShellData;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-surface-canvas">
      {/* Wide screens: a permanent column. */}
      <div className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar data={data} />
      </div>

      {/* Narrow screens: a drawer. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('nav.closeMenu')}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-neutral-950/40"
          />
          <div className="absolute inset-y-0 start-0 h-full shadow-lg">
            <Sidebar data={data} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          viewer={data.viewer}
          workspaceSlug={data.workspace.slug}
          unread={data.unread}
          onOpenSidebar={() => setDrawerOpen(true)}
        />

        <main className="mx-auto w-full max-w-content flex-1 px-page-x py-page-y">
          {children}
        </main>
      </div>
    </div>
  );
}
