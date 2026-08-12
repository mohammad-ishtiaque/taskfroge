import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug._index';
import {
  Card,
  CardHeader,
  EmptyState,
  PriorityChip,
  ProgressBar,
  ProjectStatusChip,
  StatCard,
  StatusChip,
} from '~/components/ui/Card';
import { Icon, type IconName } from '~/components/ui/Icon';
import { getDashboard, type Dashboard, type TaskCard } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { formatDate, formatRelative } from '~/lib/format';

/* ==========================================================================
   The dashboard — three of them
   --------------------------------------------------------------------------
   One layout served all three roles until the real data was looked at, and it
   was wrong for two of them. "My Tasks" and "Overdue" count work *assigned to
   you*; a client is never an assignee and a project manager assigns rather
   than holds. Both got a screen of zeros on every project, permanently.

   So the API returns a different shape per role and this file narrows on it.
   The frame — greeting, project list, activity feed — is shared, because those
   three things are the same question for everyone.
   ========================================================================== */

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);

  return {
    slug: params.slug!,
    viewerName: user.name,
    dashboard: await getDashboard(request, params.slug!),
  };
}

export default function DashboardScreen({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { slug, viewerName, dashboard } = loaderData;
  const base = `/w/${slug}`;
  const isClient = dashboard.role === 'CLIENT';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-content-primary">
            {t('dashboard.welcome', { name: viewerName })}
          </h1>
          <p className="mt-1 text-md text-content-secondary">
            {t(`dashboard.subtitle.${dashboard.role}`)}
          </p>
        </div>

        {/* A client cannot create projects, so they are not shown a button
            that would only refuse them. */}
        {!isClient && (
          <Link to={`${base}/projects/new`} className="btn-primary">
            <Icon name="plus" size={16} />
            {t('projects.new')}
          </Link>
        )}
      </header>

      <Stats dashboard={dashboard} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ProjectOverview base={base} projects={dashboard.projects} />
          <ActivityFeed activity={dashboard.activity} />
        </div>

        <div className="space-y-6">
          <Rails base={base} dashboard={dashboard} />
        </div>
      </div>
    </div>
  );
}

/* ── Stat cards, per role ───────────────────────────────────────────────── */

function Stats({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useTranslation();
  const d = dashboard;

  const cards =
    d.role === 'CLIENT'
      ? [
          { label: t('dashboard.totalProjects'), value: d.totals.projects, icon: 'folder', tone: 'brand' },
          { label: t('dashboard.finishedThisWeek'), value: d.totals.completedThisWeek, icon: 'checkCircle', tone: 'success' },
          { label: t('dashboard.waitingOnYou'), value: d.totals.waitingOnYou, icon: 'alertTriangle', tone: d.totals.waitingOnYou > 0 ? 'danger' : 'warning' },
          { label: t('dashboard.comingUp'), value: d.totals.upcoming, icon: 'calendar', tone: 'info' },
        ]
      : d.role === 'PROJECT_MANAGER'
        ? [
            { label: t('dashboard.activeProjects'), value: d.totals.activeProjects, icon: 'folder', tone: 'brand' },
            { label: t('dashboard.blocked'), value: d.totals.blocked, icon: 'alertTriangle', tone: d.totals.blocked > 0 ? 'danger' : 'warning' },
            { label: t('dashboard.overdue'), value: d.totals.overdue, icon: 'clock', tone: d.totals.overdue > 0 ? 'danger' : 'warning' },
            { label: t('dashboard.awaitingReview'), value: d.totals.awaitingReview, icon: 'checkSquare', tone: 'info' },
          ]
        : [
            { label: t('dashboard.totalProjects'), value: d.totals.projects, icon: 'folder', tone: 'brand' },
            { label: t('dashboard.myTasks'), value: d.totals.myTasks, icon: 'checkSquare', tone: 'info' },
            { label: t('status.IN_PROGRESS'), value: d.totals.inProgress, icon: 'zap', tone: 'warning' },
            { label: t('dashboard.overdue'), value: d.totals.overdue, icon: 'alertTriangle', tone: d.totals.overdue > 0 ? 'danger' : 'warning' },
          ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <StatCard
          key={c.label}
          label={c.label}
          value={c.value}
          icon={c.icon as IconName}
          tone={c.tone as 'brand' | 'success' | 'warning' | 'danger' | 'info'}
        />
      ))}
    </div>
  );
}

/* ── Rails, per role ────────────────────────────────────────────────────── */

function Rails({ base, dashboard }: { base: string; dashboard: Dashboard }) {
  const { t } = useTranslation();
  const d = dashboard;

  if (d.role === 'CLIENT') {
    return (
      <>
        <TaskRail base={base} title={t('dashboard.waitingOnYou')} tasks={d.waitingOnYou} icon="alertTriangle" tone="danger" empty={t('dashboard.nothingWaiting')} />
        <TaskRail base={base} title={t('dashboard.finishedThisWeek')} tasks={d.completedThisWeek} icon="checkCircle" empty={t('dashboard.nothingFinished')} />
        <TaskRail base={base} title={t('dashboard.comingUp')} tasks={d.upcoming} icon="calendar" empty={t('dashboard.nothingUpcoming')} />
      </>
    );
  }

  if (d.role === 'PROJECT_MANAGER') {
    return (
      <>
        <TaskRail base={base} title={t('dashboard.blocked')} tasks={d.blocked} icon="alertTriangle" tone="danger" empty={t('dashboard.nothingBlocked')} />
        <TaskRail base={base} title={t('dashboard.awaitingReview')} tasks={d.awaitingReview} icon="checkSquare" empty={t('dashboard.nothingToReview')} />
        <TaskRail base={base} title={t('dashboard.overdue')} tasks={d.overdue} icon="clock" tone="danger" empty={t('dashboard.noOverdue')} />
        <Workload workload={d.workload} />
      </>
    );
  }

  return (
    <>
      <TaskRail base={base} title={t('dashboard.myTasks')} tasks={d.myTasks} icon="checkSquare" empty={t('tasks.noneAssigned')} />
      <TaskRail base={base} title={t('dashboard.overdue')} tasks={d.overdue} icon="alertTriangle" tone="danger" empty={t('dashboard.noOverdue')} />
      <TaskRail base={base} title={t('status.IN_PROGRESS')} tasks={d.inProgress} icon="clock" empty={t('dashboard.noInProgress')} />
    </>
  );
}

/**
 * Who is carrying what.
 *
 * The PM's version of "my tasks" — they do not hold the work, so the useful
 * question is whether anyone on the team is buried. Sorted busiest first,
 * because that is the row worth acting on.
 */
function Workload({ workload }: { workload: { userId: string; name: string; open: number; overdue: number }[] }) {
  const { t } = useTranslation();

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-stroke-subtle px-card py-3.5">
        <Icon name="users" size={16} className="text-content-tertiary" />
        <h2 className="text-md font-semibold text-content-primary">{t('dashboard.teamWorkload')}</h2>
      </div>

      {workload.length === 0 ? (
        <p className="px-card py-8 text-center text-sm text-content-tertiary">
          {t('dashboard.nothingAssigned')}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {workload.map((row) => (
            <li key={row.userId} className="flex items-center gap-3 px-card py-3">
              <span className="min-w-0 flex-1 truncate text-md text-content-primary">{row.name}</span>
              {row.overdue > 0 && (
                <span className="rounded-full bg-danger-50 px-2 py-0.5 text-xs font-bold text-danger-700">
                  {t('dashboard.lateCount', { count: row.overdue })}
                </span>
              )}
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-bold text-content-secondary">
                {row.open}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */

function ProjectOverview({ base, projects }: { base: string; projects: Dashboard['projects'] }) {
  const { t, i18n } = useTranslation();

  return (
    <Card>
      <CardHeader
        title={t('dashboard.projectOverview')}
        action={
          <Link to={`${base}/projects`} className="inline-flex items-center gap-1.5 text-sm font-medium no-underline">
            {t('common.viewAll')}
            <Icon name="arrowRight" size={14} className="rtl:-scale-x-100" />
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState icon="folder" title={t('projects.none')} hint={t('projects.noneHint')} />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                to={`${base}/projects/${project.key}`}
                className="block px-card py-4 no-underline transition-colors duration-fast hover:bg-surface-hover"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-content-primary">{project.name}</p>
                    <p className="mt-0.5 line-clamp-1 text-md text-content-secondary">{project.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ProjectStatusChip status={project.status} />
                    <PriorityChip priority={project.priority} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-content-tertiary">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="users" size={13} />
                    {t('projects.memberCount', { count: project.memberCount ?? 0 })}
                  </span>
                  {project.endDate && (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="calendar" size={13} />
                      {formatDate(project.endDate, i18n.language)}
                    </span>
                  )}
                  <span className="font-mono text-xs">{project.key}</span>
                </div>

                <div className="mt-3">
                  <ProgressBar value={project.progress} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityFeed({ activity }: { activity: Dashboard['activity'] }) {
  const { t, i18n } = useTranslation();

  return (
    <Card>
      <CardHeader title={t('dashboard.recentActivity')} />

      {activity.length === 0 ? (
        <EmptyState icon="clock" title={t('dashboard.noActivity')} />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {activity.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-card py-3">
              <span
                aria-hidden
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-content-secondary"
              >
                <Icon name={activityIcon(entry.kind)} size={14} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-md text-content-primary">
                  {/* Built from a key and values, never a sentence the server
                      assembled in English. */}
                  {t(`activity.${entry.kind}`, {
                    actor: entry.actor?.name ?? '',
                    taskKey: entry.detail.taskKey ?? '',
                    from: entry.detail.from ? t(`status.${entry.detail.from}`) : '',
                    to: entry.detail.to
                      ? t(`status.${entry.detail.to}`, { defaultValue: entry.detail.to })
                      : '',
                  })}
                </p>
                <p className="text-sm text-content-tertiary">
                  {formatRelative(entry.createdAt, i18n.language)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TaskRail({
  base,
  title,
  tasks,
  icon,
  tone,
  empty,
}: {
  base: string;
  title: string;
  tasks: TaskCard[];
  icon: IconName;
  tone?: 'danger';
  empty: string;
}) {
  const highlight = tone === 'danger' && tasks.length > 0;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-stroke-subtle px-card py-3.5">
        <Icon name={icon} size={16} className={highlight ? 'text-danger-600' : 'text-content-tertiary'} />
        <h2 className="text-md font-semibold text-content-primary">{title}</h2>
        <span
          className={
            highlight
              ? 'ms-auto rounded-full bg-danger-50 px-2 py-0.5 text-xs font-bold text-danger-700'
              : 'ms-auto rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-bold text-content-secondary'
          }
        >
          {tasks.length}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="px-card py-8 text-center text-sm text-content-tertiary">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {tasks.slice(0, 5).map((task) => (
            <li key={task.id}>
              <Link to={`${base}/tasks/${task.key}`} className="block px-card py-3 no-underline hover:bg-surface-hover">
                <p className="truncate text-md font-medium text-content-primary">{task.title}</p>
                {task.blockedReason && (
                  <p className="mt-1 line-clamp-2 text-sm text-danger-700">{task.blockedReason}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-content-tertiary">{task.key}</span>
                  <StatusChip status={task.status} />
                  <PriorityChip priority={task.priority} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function activityIcon(kind: string): IconName {
  switch (kind) {
    case 'COMMENTED': return 'messageSquare';
    case 'BLOCKED': return 'alertTriangle';
    case 'ASSIGNED': return 'user';
    case 'VISIBILITY_CHANGED': return 'eye';
    case 'TASK_CREATED': return 'plus';
    default: return 'checkCircle';
  }
}
