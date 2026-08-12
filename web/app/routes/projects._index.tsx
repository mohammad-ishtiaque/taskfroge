import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/projects._index';
import { ApiError } from '~/lib/api.server';
import { listProjects, type ProjectSummary } from '~/lib/projects.server';
import { requireUser } from '~/lib/session.server';
import { Button } from '~/components/ui/Button';
import { AppHeader } from '~/components/layout/AppHeader';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Projects · TaskForge' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);

  try {
    return { user, projects: await listProjects(request), failed: false as const };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;

    // A project list that errors is a dead end. Show the page with an empty
    // state and let them retry, rather than an error screen with no way out.
    console.error('[projects] list failed', error);
    return { user, projects: [] as ProjectSummary[], failed: true as const };
  }
}

export default function ProjectsIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, projects, failed } = loaderData;
  const isManager = user.role === 'PROJECT_MANAGER';

  return (
    <div className="min-h-dvh bg-surface-canvas">
      <AppHeader user={user} />

      <main className="mx-auto max-w-content px-page-x py-page-y">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl">{t('projects.title')}</h1>
          {isManager && (
            <Link to="/projects/new">
              <Button variant="primary">{t('projects.new')}</Button>
            </Link>
          )}
        </div>

        {failed && (
          <p role="alert" className="mt-4 rounded-md bg-danger-50 px-4 py-3 text-md text-danger-700">
            {t('errors.NETWORK')}
          </p>
        )}

        {projects.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-stroke px-6 py-12 text-center">
            <p className="text-lg font-semibold">{t('projects.none')}</p>
            <p className="mt-1 text-md text-content-secondary">
              {isManager ? t('projects.noneHintPm') : t('projects.noneHintOther')}
            </p>
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.key}`}
                  className="block h-full rounded-lg border border-stroke-subtle bg-surface-raised
                             p-card no-underline shadow-xs transition-shadow duration-fast hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <code className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-xs font-semibold text-content-secondary">
                      {project.key}
                    </code>
                    {project.status === 'ARCHIVED' && (
                      <span className="text-xs text-content-tertiary">
                        {t('projects.archived')}
                      </span>
                    )}
                  </div>

                  <h2 className="mt-2 text-lg font-semibold text-content-primary">
                    {project.name}
                  </h2>

                  {project.description && (
                    <p className="mt-1 line-clamp-2 text-md text-content-secondary">
                      {project.description}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-content-tertiary">
                    {t('projects.members', { count: project._count.members })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
