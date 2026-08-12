import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from './Icon';
import { cn } from '~/lib/cn';
import type { Priority, ProjectStatus, TaskStatus, TaskType } from '~/data/types';

/* ==========================================================================
   The surfaces and chips every screen is built from.

   Collected in one file on purpose. Padding, radius and border are decided
   once here; a screen that wants a panel imports Card rather than writing
   `rounded-lg border p-6` again with slightly different numbers. That is the
   whole mechanism behind "uniform padding across screens written weeks apart".
   ========================================================================== */

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-stroke-subtle bg-surface-raised',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-stroke-subtle px-card py-4">
      <h2 className="text-lg font-semibold text-content-primary">{title}</h2>
      {action}
    </div>
  );
}

/**
 * The four-across stat row at the top of the dashboard and every project.
 *
 * `tone` colours only the icon chip, never the number. A page of four coloured
 * numbers has no hierarchy — everything shouts and nothing reads.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: IconName;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600',
    info: 'bg-info-50 text-info-600',
  };

  return (
    <Card className="p-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-md font-medium text-content-secondary">{label}</p>
        <span
          aria-hidden
          className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tones[tone])}
        >
          <Icon name={icon} size={18} />
        </span>
      </div>

      <p className="mt-2 text-3xl font-bold text-content-primary">{value}</p>
      {hint && <p className="mt-1 text-sm text-content-tertiary">{hint}</p>}
    </Card>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-content-secondary">{label ?? t('common.progress')}</span>
        <span className="font-medium text-content-primary">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        {/* Width, not transform — a transform would need an RTL flip. */}
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Chips ──────────────────────────────────────────────────────────────
   Each reads its colour from the token set, so the board, the table and the
   dashboard cannot drift into three different greens for DONE.              */

export function StatusChip({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  const cssVar = `--status-${status.toLowerCase().replace('_', '-')}`;

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: `color-mix(in srgb, var(${cssVar}) 14%, transparent)`, color: `var(${cssVar})` }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: `var(${cssVar})` }} />
      {t(`status.${status}`)}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  const cssVar = `--priority-${priority.toLowerCase()}`;

  return (
    <span
      className="inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ background: `color-mix(in srgb, var(${cssVar}) 14%, transparent)`, color: `var(${cssVar})` }}
    >
      {t(`priority.${priority}`)}
    </span>
  );
}

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation();

  const tones: Record<ProjectStatus, string> = {
    PLANNING: 'bg-surface-sunken text-content-secondary',
    ACTIVE: 'bg-info-50 text-info-700',
    ON_HOLD: 'bg-warning-50 text-warning-700',
    COMPLETED: 'bg-success-50 text-success-700',
    CANCELLED: 'bg-danger-50 text-danger-700',
  };

  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-[var(--tracking-caps)]',
        tones[status],
      )}
    >
      {t(`projectStatus.${status}`)}
    </span>
  );
}

const TYPE_ICONS: Record<TaskType, IconName> = {
  TASK: 'checkSquare',
  BUG: 'bug',
  STORY: 'bookmark',
  CHORE: 'wrench',
};

const TYPE_COLORS: Record<TaskType, string> = {
  TASK: 'var(--info-600)',
  BUG: 'var(--danger-600)',
  STORY: 'var(--success-600)',
  CHORE: 'var(--neutral-500)',
};

export function TypeChip({ type }: { type: TaskType }) {
  const { t } = useTranslation();

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold"
      style={{ color: TYPE_COLORS[type] }}
    >
      <Icon name={TYPE_ICONS[type]} size={13} />
      {t(`taskType.${type}`)}
    </span>
  );
}

/** An empty state that says what to do, not just that there is nothing. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-card py-12 text-center">
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-full bg-surface-sunken text-content-tertiary"
      >
        <Icon name={icon} size={20} />
      </span>
      <p className="text-md font-medium text-content-primary">{title}</p>
      {hint && <p className="max-w-sm text-sm text-content-tertiary">{hint}</p>}
      {action}
    </div>
  );
}
