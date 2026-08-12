import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects.$key.analytics';
import { Card, CardHeader, StatCard } from '~/components/ui/Card';
import { getProjectStats } from '~/data/gateway.server';
import { PRIORITIES, TASK_STATUSES, TASK_TYPES } from '~/data/types';

export async function loader({ request, params }: Route.LoaderArgs) {
  const stats = await getProjectStats(request, params.key!);

  // `?? 0` on every read, and it is not belt-and-braces.
  //
  // The API zero-fills these now, so in principle every key is present. It did
  // not always: `groupBy` returns only the rows that exist, so a project with
  // one in-progress task answered `{ IN_PROGRESS: 1 }` and this line computed
  // `1 + undefined + undefined`. React renders NaN as the letters N-a-N in a
  // stat card, and the type said `Record<TaskStatus, number>` throughout, so
  // neither side had anything to complain about.
  //
  // The API being fixed is the real fix. This is the screen refusing to be the
  // one that prints nonsense if it ever regresses — a missing count should
  // read as zero, not as a word.
  const count = (status: keyof typeof stats.byStatus) => stats.byStatus[status] ?? 0;

  return {
    stats,
    // Active means started but not finished — the number a PM actually wants.
    active: count('IN_PROGRESS') + count('IN_REVIEW') + count('BLOCKED'),
  };
}

/**
 * Analytics without a chart library.
 *
 * Bars are divs and the donut is one SVG circle with a dash offset. A charting
 * dependency is ~50 KB to draw three shapes we fully control, and it would
 * bring its own colours — which is precisely how a design system springs a
 * leak. These read their colours from the same tokens as the board.
 */
export default function AnalyticsTab({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { stats, active } = loaderData;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('analytics.completionRate')} value={`${stats.completionRate}%`} icon="checkCircle" tone="success" />
        <StatCard label={t('analytics.activeTasks')} value={active} icon="clock" tone="info" />
        <StatCard label={t('analytics.overdueTasks')} value={stats.overdueTasks} icon="alertTriangle" tone={stats.overdueTasks > 0 ? 'danger' : 'warning'} />
        <StatCard label={t('analytics.teamSize')} value={stats.teamSize} icon="users" tone="brand" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('analytics.byStatus')} />
          <div className="p-card">
            <BarChart
              rows={TASK_STATUSES.map((status) => ({
                label: t(`status.${status}`),
                value: stats.byStatus[status] ?? 0,
                color: `var(--status-${status.toLowerCase().replace('_', '-')})`,
              }))}
              total={stats.totalTasks}
              emptyLabel={t('analytics.noTasks')}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('analytics.byType')} />
          <div className="p-card">
            <BarChart
              rows={TASK_TYPES.map((type, i) => ({
                label: t(`taskType.${type}`),
                value: stats.byType[type] ?? 0,
                color: ['var(--info-600)', 'var(--danger-600)', 'var(--success-600)', 'var(--neutral-500)'][i]!,
              }))}
              total={stats.totalTasks}
              emptyLabel={t('analytics.noTasks')}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('analytics.byPriority')} />
          <div className="p-card">
            <BarChart
              rows={PRIORITIES.map((priority) => ({
                label: t(`priority.${priority}`),
                value: stats.byPriority[priority] ?? 0,
                color: `var(--priority-${priority.toLowerCase()})`,
              }))}
              total={stats.totalTasks}
              emptyLabel={t('analytics.noTasks')}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Horizontal bars rather than vertical.
 *
 * Labels sit beside the bar and read left-to-right (or right-to-left) with the
 * text around them. Vertical bars force rotated labels the moment a category
 * is called "In Progress" — and rotated text in Arabic is worse still.
 */
function BarChart({
  rows,
  total,
  emptyLabel,
}: {
  rows: { label: string; value: number; color: string }[];
  total: number;
  emptyLabel: string;
}) {
  if (total === 0) {
    return <p className="py-6 text-center text-md text-content-tertiary">{emptyLabel}</p>;
  }

  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const share = Math.round((row.value / total) * 100);

        return (
          <li key={row.label}>
            <div className="flex items-center justify-between gap-3 text-md">
              <span className="inline-flex items-center gap-2 text-content-secondary">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: row.color }} />
                {row.label}
              </span>
              <span className="text-content-tertiary">
                <span className="font-semibold text-content-primary">{row.value}</span>
                <span className="ms-2 text-sm">{share}%</span>
              </span>
            </div>

            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full transition-[width] duration-normal ease-out"
                style={{ width: `${(row.value / max) * 100}%`, background: row.color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
