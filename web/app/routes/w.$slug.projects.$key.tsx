import { NavLink, Outlet, Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects.$key';
import { ProjectStatusChip, StatCard } from '~/components/ui/Card';
import { Icon, type IconName } from '~/components/ui/Icon';
import { cn } from '~/lib/cn';
import { getProject, getProjectStats } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';

/**
 * The project frame: header, four stat cards, tab bar.
 *
 * A layout rather than repeated markup, so switching from Tasks to Analytics
 * does not re-fetch or re-render the stats above them — and so the four tabs
 * cannot drift into four slightly different headers.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);

  // The API answers 404 rather than 403 for a project you cannot reach, and
  // `callApi` turns that into an ApiError the boundary renders. Nothing here
  // needs to decide it.
  const [project, stats] = await Promise.all([
    getProject(request, params.key!),
    getProjectStats(request, params.key!),
  ]);

  return {
    slug: params.slug!,
    project,
    stats,
    isClient: user.role === 'CLIENT',
    isManager: user.role === 'PROJECT_MANAGER',
  };
}

export default function ProjectLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { project, stats, slug, isClient, isManager } = loaderData;
  const base = `/w/${slug}/projects/${project.key}`;

  // The board is only offered to a client when the project says they may see
  // it. Hiding the tab is presentation; the route itself also checks.
  const tabs: { to: string; icon: IconName; label: string; hidden?: boolean }[] = [
    { to: `${base}/tasks`, icon: 'checkSquare', label: t('nav.tasks') },
    { to: `${base}/board`, icon: 'columns', label: t('nav.board'), hidden: isClient && !project.visibility.showBoard },
    { to: `${base}/calendar`, icon: 'calendar', label: t('nav.calendar') },
    { to: `${base}/analytics`, icon: 'barChart', label: t('nav.analytics') },
    // `!isManager`, not `isClient`. The settings route refuses anyone who is
    // not a project manager, so offering the tab to a developer was offering
    // them a 404 — the tab bar and the route disagreed about who this screen
    // is for, and the route was right.
    { to: `${base}/settings`, icon: 'settings', label: t('nav.settings'), hidden: !isManager },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to={`/w/${slug}/projects`}
            aria-label={t('common.back')}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-content-secondary no-underline hover:bg-surface-hover"
          >
            <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" />
          </Link>
          <h1 className="truncate text-2xl font-bold text-content-primary">{project.name}</h1>
          <ProjectStatusChip status={project.status} />
        </div>

        {!isClient && (
          <Link
            to={`${base}/tasks?new=1`}
            className="btn-primary"
          >
            <Icon name="plus" size={16} />
            {t('tasks.new')}
          </Link>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('project.totalTasks')} value={stats.totalTasks} icon="checkSquare" tone="brand" />
        <StatCard label={t('project.completed')} value={stats.completedTasks} icon="checkCircle" tone="success" />
        <StatCard label={t('status.IN_PROGRESS')} value={stats.inProgressTasks} icon="zap" tone="warning" />
        <StatCard label={t('project.teamMembers')} value={stats.teamSize} icon="users" tone="info" />
      </div>

      <nav aria-label={t('project.views')} className="flex flex-wrap gap-1 rounded-lg border border-stroke-subtle bg-surface-raised p-1">
        {tabs.filter((tab) => !tab.hidden).map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-md font-medium no-underline transition-colors duration-fast',
                isActive
                  ? 'bg-surface-sunken text-content-primary'
                  : 'text-content-secondary hover:bg-surface-hover hover:text-content-primary',
              )
            }
          >
            <Icon name={tab.icon} size={15} />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
