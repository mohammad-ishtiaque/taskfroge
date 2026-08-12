import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.search';
import { Card, EmptyState, PriorityChip, StatusChip, TypeChip } from '~/components/ui/Card';
import type { Task } from '~/data/types';

type SearchTask = Task & { projectKey: string };
import { getWorkspace, listProjects, listTasks } from '~/data/gateway.server';

export async function loader({ request, params }: Route.LoaderArgs) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();

  if (!q) {
    return { slug: params.slug!, q, projects: [] as Awaited<ReturnType<typeof listProjects>>, tasks: [] as SearchTask[] };
  }

  const workspace = await getWorkspace(request, params.slug!);

  const [projects, allProjects] = await Promise.all([
    listProjects(request, { workspaceId: workspace.id, search: q }),
    listProjects(request, { workspaceId: workspace.id }),
  ]);

  // One request per project rather than a single search endpoint. Acceptable
  // at this size, and it means search inherits the same scoping as every other
  // list — a client cannot find a hidden task by searching for it.
  const perProject = await Promise.all(
    allProjects.map(async (project) =>
      (await listTasks(request, project.key, { search: q, includeSubtasks: true })).map((task) => ({
        ...task,
        projectKey: project.key,
      })),
    ),
  );

  return { slug: params.slug!, q, projects, tasks: perProject.flat() };
}

export default function SearchResults({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { q, projects, tasks, slug } = loaderData;
  const total = projects.length + tasks.length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-content-primary">{t('search.title')}</h1>
        <p className="mt-1 text-md text-content-secondary">
          {q ? t('search.resultsFor', { count: total, query: q }) : t('search.prompt')}
        </p>
      </header>

      {q && total === 0 && (
        <Card>
          <EmptyState icon="search" title={t('search.noResults')} hint={t('search.noResultsHint')} />
        </Card>
      )}

      {projects.length > 0 && (
        <Card>
          <div className="border-b border-stroke-subtle px-card py-3.5">
            <h2 className="text-md font-semibold text-content-primary">
              {t('nav.projects')} · {projects.length}
            </h2>
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {projects.map((project) => (
              <li key={project.id}>
                <Link to={`/w/${slug}/projects/${project.key}`} className="block px-card py-3 no-underline hover:bg-surface-hover">
                  <span className="text-md font-medium text-content-primary">{project.name}</span>
                  <span className="ms-2 font-mono text-xs text-content-tertiary">{project.key}</span>
                  <span className="mt-0.5 block text-sm text-content-secondary">{project.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tasks.length > 0 && (
        <Card>
          <div className="border-b border-stroke-subtle px-card py-3.5">
            <h2 className="text-md font-semibold text-content-primary">
              {t('nav.tasks')} · {tasks.length}
            </h2>
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link to={`/w/${slug}/tasks/${task.key}`} className="block px-card py-3 no-underline hover:bg-surface-hover">
                  <span className="text-md font-medium text-content-primary">{task.title}</span>
                  <span className="ms-2 font-mono text-xs text-content-tertiary">{task.key}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <TypeChip type={task.type} />
                    <StatusChip status={task.status} />
                    <PriorityChip priority={task.priority} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
