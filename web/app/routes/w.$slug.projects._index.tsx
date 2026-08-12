import { Form, Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects._index';
import { Card, EmptyState, PriorityChip, ProgressBar, ProjectStatusChip } from '~/components/ui/Card';
import { Icon } from '~/components/ui/Icon';
import { getWorkspace, listProjects } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { formatDate } from '~/lib/format';
import { PRIORITIES } from '~/data/types';

const PROJECT_STATUSES = ['ACTIVE', 'PLANNING', 'COMPLETED', 'ON_HOLD', 'CANCELLED'] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const workspace = await getWorkspace(request, params.slug!);
  const url = new URL(request.url);

  // Filters live in the URL, not in state: a filtered list is then linkable,
  // survives a refresh, and the back button does what it looks like it does.
  return {
    slug: params.slug!,
    canCreate: user.role === 'PROJECT_MANAGER',
    projects: await listProjects(request, {
      workspaceId: workspace.id,
      status: url.searchParams.get('status') ?? undefined,
      priority: url.searchParams.get('priority') ?? undefined,
      search: url.searchParams.get('q') ?? undefined,
      includeArchived: url.searchParams.get('archived') === '1',
    }),
  };
}

export default function ProjectsIndex({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const base = `/w/${loaderData.slug}`;
  const filtered =
    params.has('q') || params.has('status') || params.has('priority') || params.has('archived');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-content-primary">{t('nav.projects')}</h1>
          <p className="mt-1 text-md text-content-secondary">{t('projects.subtitle')}</p>
        </div>

        {loaderData.canCreate && (
          <Link
            to={`${base}/projects/new`}
            className="btn-primary"
          >
            <Icon name="plus" size={16} />
            {t('projects.new')}
          </Link>
        )}
      </header>

      {/* A GET form: submitting puts the filters in the query string. The
          selects auto-submit with JS and still work with the button without. */}
      <Form method="get" className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-content-tertiary"
          />
          <input
            type="search"
            name="q"
            defaultValue={params.get('q') ?? ''}
            placeholder={t('projects.searchPlaceholder')}
            aria-label={t('projects.searchPlaceholder')}
            className="field-pill"
          />
        </div>

        <select
          name="status"
          defaultValue={params.get('status') ?? 'ALL'}
          aria-label={t('projects.filterStatus')}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="select-pill"
        >
          <option value="ALL">{t('projects.allStatus')}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`projectStatus.${s}`)}</option>
          ))}
        </select>

        <select
          name="priority"
          defaultValue={params.get('priority') ?? 'ALL'}
          aria-label={t('projects.filterPriority')}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="select-pill"
        >
          <option value="ALL">{t('projects.allPriority')}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{t(`priority.${p}`)}</option>
          ))}
        </select>

        {/* Off by default. On, an archived project is reachable again, which
            is the only way its Restore button can ever be pressed — archiving
            without this is a one-way door. */}
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-stroke-subtle px-4 text-md text-content-secondary hover:bg-surface-hover">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={params.get('archived') === '1'}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
          {t('projects.showArchived')}
        </label>

        <button
          type="submit"
          className="h-10 rounded-full border border-stroke-subtle px-4 text-md font-medium text-content-secondary hover:bg-surface-hover"
        >
          {t('common.apply')}
        </button>
      </Form>

      {loaderData.projects.length === 0 ? (
        <Card>
          <EmptyState
            icon="folder"
            title={t(filtered ? 'projects.noMatches' : 'projects.none')}
            hint={t(filtered ? 'projects.noMatchesHint' : 'projects.noneHint')}
            action={
              filtered ? (
                <Link to={`${base}/projects`} className="text-md font-medium">
                  {t('common.clearFilters')}
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loaderData.projects.map((project) => (
            <li key={project.id}>
              <Link
                to={`${base}/projects/${project.key}`}
                className="block h-full no-underline"
              >
                <Card className="h-full p-card transition-shadow duration-fast hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-content-primary">
                        {project.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-md text-content-secondary">
                        {project.description}
                      </p>
                    </div>
                    <span className="shrink-0 text-end">
                      <span className="block font-mono text-xs text-content-tertiary">
                        {project.key}
                      </span>
                      {project.archivedAt && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-content-tertiary">
                          <Icon name="archive" size={11} />
                          {t('projects.archived')}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <ProjectStatusChip status={project.status} />
                    <PriorityChip priority={project.priority} />
                  </div>

                  <div className="mt-4">
                    <ProgressBar value={project.progress} />
                  </div>

                  <div className="mt-4 flex items-center gap-4 text-sm text-content-tertiary">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="users" size={13} />
                      {project.memberIds.length}
                    </span>
                    {project.endDate && (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="calendar" size={13} />
                        {formatDate(project.endDate, i18n.language)}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
