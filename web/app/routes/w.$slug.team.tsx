import { Form, Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.team';
import { Card, EmptyState, StatCard } from '~/components/ui/Card';
import { Icon } from '~/components/ui/Icon';
import { getWorkspace, listMembers, listProjects, listTasks } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import type { Person, Task } from '~/data/types';
import { OPEN_STATUSES } from '~/data/types';

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const workspace = await getWorkspace(request, params.slug!);
  const projects = await listProjects(request, { workspaceId: workspace.id });
  const term = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();

  // Everyone on any project in this workspace, de-duplicated. Assembled from
  // the per-project assignable lists rather than one org-wide roster, so the
  // page can never show someone this workspace has nothing to do with.
  const perProject = await Promise.all(
    projects.map(async (project) => ({
      project,
      people: await listMembers(request, project.key),
      tasks: await listTasks(request, project.key),
    })),
  );

  const byId = new Map<string, Person>();
  const tasks: Task[] = [];
  const projectsOf = new Map<string, number>();

  for (const entry of perProject) {
    tasks.push(...entry.tasks);
    for (const person of entry.people) {
      byId.set(person.id, person);
      projectsOf.set(person.id, (projectsOf.get(person.id) ?? 0) + 1);
    }
  }

  const members = [...byId.values()]
    .filter((p) => !term || `${p.name} ${p.email}`.toLowerCase().includes(term))
    .map((person) => {
      const theirs = tasks.filter((t) => t.assigneeId === person.id);
      return {
        ...person,
        // Open work, not everything ever assigned — a count that only grows is
        // not a workload, it is a tenure.
        openTasks: theirs.filter((t) => OPEN_STATUSES.includes(t.status)).length,
        doneTasks: theirs.filter((t) => t.status === 'DONE').length,
        projectCount: projectsOf.get(person.id) ?? 0,
      };
    })
    .sort((a, b) => b.openTasks - a.openTasks);

  return {
    members,
    slug: params.slug!,
    firstProjectKey: projects[0]?.key ?? null,
    canInvite: user.role === 'PROJECT_MANAGER',
    totals: {
      members: members.length,
      activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
      tasks: tasks.length,
    },
  };
}

export default function TeamPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const d = loaderData;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-content-primary">{t('nav.team')}</h1>
          <p className="mt-1 text-md text-content-secondary">{t('team.subtitle')}</p>
        </div>

        {/* Membership is per project, so inviting starts from a project.
            A button here that opened a dialog would have to ask "to which
            project?" as its first question. */}
        {d.canInvite && d.firstProjectKey && (
          <Link to={`/w/${d.slug}/projects/${d.firstProjectKey}/settings`} className="btn-primary">
            <Icon name="plus" size={16} />
            {t('team.invite')}
          </Link>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('team.totalMembers')} value={d.totals.members} icon="users" tone="brand" />
        <StatCard label={t('team.activeProjects')} value={d.totals.activeProjects} icon="zap" tone="success" />
        <StatCard label={t('team.totalTasks')} value={d.totals.tasks} icon="checkSquare" tone="info" />
      </div>

      <Form method="get" className="relative max-w-md">
        <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-content-tertiary" />
        <input
          type="search"
          name="q"
          defaultValue={params.get('q') ?? ''}
          placeholder={t('team.searchPlaceholder')}
          aria-label={t('team.searchPlaceholder')}
          className="field-pill"
        />
      </Form>

      <Card className="overflow-hidden">
        {d.members.length === 0 ? (
          <EmptyState icon="users" title={t('team.noMatches')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem]">
              <thead>
                <tr className="border-b border-stroke-subtle bg-surface-sunken/60">
                  {['name', 'email', 'role', 'projects', 'openTasks', 'completed'].map((key) => (
                    <th key={key} scope="col" className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-[var(--tracking-caps)] text-content-tertiary">
                      {t(`team.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-subtle)]">
                {d.members.map((member) => (
                  <tr key={member.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-3">
                        <span aria-hidden className="flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: member.avatarColor }}>
                          {member.initials}
                        </span>
                        <span className="font-medium text-content-primary">{member.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-md text-content-secondary">{member.email}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md px-2 py-1 text-xs font-semibold" style={{ background: `color-mix(in srgb, var(--role-${member.role.toLowerCase().replace('_', '-')}) 14%, transparent)`, color: `var(--role-${member.role.toLowerCase().replace('_', '-')})` }}>
                        {t(`roles.${member.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-md text-content-secondary">{member.projectCount}</td>
                    <td className="px-4 py-3 text-md font-medium text-content-primary">{member.openTasks}</td>
                    <td className="px-4 py-3 text-md text-content-secondary">{member.doneTasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
