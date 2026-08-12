import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects.$key.calendar';
import { Card, CardHeader, EmptyState, TypeChip } from '~/components/ui/Card';
import { Icon } from '~/components/ui/Icon';
import { listTasks } from '~/data/gateway.server';
import { formatDate } from '~/lib/format';

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);

  // The month is a URL parameter so a particular month is linkable and the
  // back button steps through months rather than leaving the page.
  const now = new Date();
  const year = Number(url.searchParams.get('y') ?? now.getFullYear());
  const month = Number(url.searchParams.get('m') ?? now.getMonth());

  const tasks = (await listTasks(request, params.key!)).filter((t) => t.dueDate);

  return {
    slug: params.slug!,
    year,
    month,
    todayIso: new Date().toDateString(),
    tasks: tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, type: t.type, dueDate: t.dueDate! })),
  };
}

export default function CalendarTab({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const { year, month, tasks, slug } = loaderData;

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();

  const byDay = new Map<number, typeof tasks>();
  for (const task of tasks) {
    const due = new Date(task.dueDate);
    if (due.getFullYear() === year && due.getMonth() === month) {
      const list = byDay.get(due.getDate()) ?? [];
      list.push(task);
      byDay.set(due.getDate(), list);
    }
  }

  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(first);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(new Date(2024, 0, 7 + i)),
  );

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    const next = new URLSearchParams(params);
    next.set('y', String(d.getFullYear()));
    next.set('m', String(d.getMonth()));
    return `?${next}`;
  };

  const upcoming = [...tasks]
    .filter((task) => new Date(task.dueDate) >= new Date(new Date().toDateString()))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
      <Card>
        <div className="flex items-center justify-between gap-4 border-b border-stroke-subtle px-card py-4">
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-content-primary">
            <Icon name="calendar" size={17} />
            {t('calendar.title')}
          </h2>

          <div className="flex items-center gap-2">
            {/* Chevrons flip in Arabic: "previous" is on the reading-start side. */}
            <Link to={step(-1)} aria-label={t('calendar.previousMonth')} className="flex size-8 items-center justify-center rounded-md text-content-secondary no-underline hover:bg-surface-hover">
              <Icon name="chevronLeft" size={16} className="rtl:-scale-x-100" />
            </Link>
            <span className="min-w-[9rem] text-center text-md font-medium text-content-primary">{monthLabel}</span>
            <Link to={step(1)} aria-label={t('calendar.nextMonth')} className="flex size-8 items-center justify-center rounded-md text-content-secondary no-underline hover:bg-surface-hover">
              <Icon name="chevronRight" size={16} className="rtl:-scale-x-100" />
            </Link>
          </div>
        </div>

        <div className="p-card">
          <div className="grid grid-cols-7 gap-2">
            {weekdays.map((day) => (
              <div key={day} className="pb-1 text-center text-xs font-semibold text-content-tertiary">{day}</div>
            ))}

            {Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} />)}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const date = i + 1;
              const dayTasks = byDay.get(date) ?? [];
              const isToday = new Date(year, month, date).toDateString() === loaderData.todayIso;

              return (
                <div
                  key={date}
                  className={
                    isToday
                      ? 'min-h-[4.5rem] rounded-lg border border-brand-500 bg-brand-50 p-2'
                      : 'min-h-[4.5rem] rounded-lg bg-surface-sunken p-2'
                  }
                >
                  <span className={isToday ? 'text-sm font-bold text-brand-700' : 'text-sm text-content-secondary'}>
                    {date}
                  </span>
                  {dayTasks.length > 0 && (
                    <span className="mt-1 block text-xs font-medium text-content-brand">
                      {t('calendar.taskCount', { count: dayTasks.length })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="h-fit">
        <CardHeader title={t('calendar.upcoming')} />
        {upcoming.length === 0 ? (
          <EmptyState icon="clock" title={t('calendar.nothingUpcoming')} />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {upcoming.map((task) => (
              <li key={task.id}>
                <Link to={`/w/${slug}/tasks/${task.key}`} className="block px-card py-3 no-underline hover:bg-surface-hover">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-md font-medium text-content-primary">{task.title}</p>
                    <TypeChip type={task.type} />
                  </div>
                  <p className="mt-1 text-sm text-content-tertiary">
                    {formatDate(task.dueDate, i18n.language)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
