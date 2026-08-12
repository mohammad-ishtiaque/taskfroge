import { useState } from 'react';
import { Form, Link, NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '~/components/ui/Icon';
import { cn } from '~/lib/cn';
import type { OrganizationSummary, Person, Project, Task, Workspace } from '~/data/types';

export interface SidebarData {
  workspace: Workspace;
  workspaces: Workspace[];
  /** Every account this person belongs to. One, for almost everybody. */
  organizations: OrganizationSummary[];
  projects: Project[];
  myTasks: Task[];
  canCreateProject: boolean;
  /** Here rather than only on `ShellData` because the nav has to know the role:
      several of the links below lead to screens only a manager may open. */
  viewer: Person;
}

/**
 * The sidebar.
 *
 * Structure follows the template: workspace header with a switcher, primary
 * nav, a My Tasks section, then a project tree that expands into the four
 * project views.
 *
 * Two things are ours rather than the template's:
 *
 * - **Every horizontal direction is logical.** `ps-*`, `ms-*`, `border-e`, and
 *   the chevron flips on `rtl:`. The sidebar moves to the right-hand side in
 *   Arabic without a second stylesheet.
 * - **The project tree is `<details>`.** Native disclosure means it works
 *   before hydration and is keyboard-operable without us writing either.
 */
export function Sidebar({ data, onNavigate }: { data: SidebarData; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const base = `/w/${data.workspace.slug}`;
  const isManager = data.viewer.role === 'PROJECT_MANAGER';

  return (
    <nav
      aria-label={t('nav.primary')}
      className="flex h-full w-sidebar shrink-0 flex-col border-e border-stroke-subtle bg-surface-raised"
    >
      <WorkspaceHeader
        workspace={data.workspace}
        workspaces={data.workspaces}
        organizations={data.organizations}
        canCreateProject={data.canCreateProject}
      />

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        <ul className="mt-3 space-y-1">
          <NavItem to={base} icon="layoutDashboard" label={t('nav.dashboard')} end onClick={onNavigate} />
          <NavItem to={`${base}/projects`} icon="folderOpen" label={t('nav.projects')} onClick={onNavigate} />
          <NavItem to={`${base}/team`} icon="users" label={t('nav.team')} onClick={onNavigate} />
          <NavItem to={`${base}/settings`} icon="settings" label={t('nav.settings')} onClick={onNavigate} />
        </ul>

        {/* My Tasks — open by default because it is the reason most people
            come back to the app, and closed-by-default hides the count. */}
        <details className="group mt-6" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover">
            <Icon name="checkSquare" size={15} />
            <span>{t('nav.myTasks')}</span>
            {data.myTasks.length > 0 && (
              <span className="rounded-full bg-surface-sunken px-2 text-xs font-semibold text-content-secondary">
                {data.myTasks.length}
              </span>
            )}
            <Icon
              name="chevronDown"
              size={14}
              className="ms-auto transition-transform duration-fast group-open:rotate-180"
            />
          </summary>

          <ul className="mt-1 space-y-1 ps-3">
            {data.myTasks.length === 0 && (
              <li className="px-3 py-1.5 text-xs text-content-tertiary">{t('tasks.noneAssigned')}</li>
            )}
            {data.myTasks.slice(0, 6).map((task) => (
              <li key={task.id}>
                <Link
                  to={`${base}/tasks/${task.key}`}
                  onClick={onNavigate}
                  className="flex items-start gap-2 rounded-md px-3 py-1.5 no-underline hover:bg-surface-hover"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 size-1.5 shrink-0 rounded-full"
                    style={{ background: `var(--status-${task.status.toLowerCase().replace('_', '-')})` }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-content-primary">
                      {task.title}
                    </span>
                    <span className="block text-xs text-content-tertiary">
                      {t(`status.${task.status}`)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>

        {/* Projects */}
        <div className="mt-6 flex items-center justify-between px-3">
          <h2 className="text-xs font-semibold uppercase tracking-[var(--tracking-caps)] text-content-tertiary">
            {t('nav.projects')}
          </h2>
          <Link
            to={`${base}/projects`}
            onClick={onNavigate}
            aria-label={t('nav.allProjects')}
            className="text-content-tertiary no-underline hover:text-content-primary"
          >
            {/* Points the way the language reads. */}
            <Icon name="arrowRight" size={14} className="rtl:-scale-x-100" />
          </Link>
        </div>

        <ul className="mt-1 space-y-1">
          {data.projects.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-content-tertiary">{t('projects.none')}</li>
          )}

          {data.projects.map((project) => {
            const href = `${base}/projects/${project.key}`;
            const active = pathname.startsWith(href);

            return (
              <li key={project.id}>
                <details open={active} className="group/proj">
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-hover">
                    <Icon name="chevronRight" size={13} className="text-content-tertiary transition-transform duration-fast group-open/proj:rotate-90 rtl:-scale-x-100" />
                    <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand-500" />
                    <span className="truncate text-sm font-medium text-content-primary">
                      {project.name}
                    </span>
                  </summary>

                  <ul className="mt-1 space-y-0.5 ps-8">
                    <SubItem to={`${href}/tasks`} icon="columns" label={t('nav.tasks')} onClick={onNavigate} />
                    <SubItem to={`${href}/analytics`} icon="barChart" label={t('nav.analytics')} onClick={onNavigate} />
                    <SubItem to={`${href}/calendar`} icon="calendar" label={t('nav.calendar')} onClick={onNavigate} />
                    {/* Managers only. The settings route answers 404 to
                        everyone else, so this link was a dead end in the
                        sidebar of every developer using the product. */}
                    {isManager && (
                      <SubItem to={`${href}/settings`} icon="settings" label={t('nav.settings')} onClick={onNavigate} />
                    )}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>

      </div>
    </nav>
  );
}

/* ── Workspace switcher ─────────────────────────────────────────────────── */

function WorkspaceHeader({
  workspace,
  workspaces,
  organizations,
  canCreateProject,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  organizations: OrganizationSummary[];
  canCreateProject: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Opens at any count. The dropdown is not only a switcher — it is also
  // where a workspace gets created, so disabling it when you have one would
  // leave you with no way to make a second.

  return (
    <div className="relative border-b border-stroke-subtle p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-3 rounded-lg p-2 text-start hover:bg-surface-hover"
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white"
        >
          {workspace.name.slice(0, 1)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-content-primary">
            {workspace.name}
          </span>
          <span className="block text-xs text-content-tertiary">
            {t('workspace.projectCount', { count: workspace.projectCount })}
          </span>
        </span>

        <Icon name="chevronDown" size={14} className="text-content-tertiary" />
      </button>

      {open && (
        <>
          {/* Click-away. A transparent sibling rather than a document listener,
              so it cannot outlive the menu. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />

          <div
            role="menu"
            className="absolute start-3 z-20 mt-1 w-[calc(var(--sidebar-width)-1.5rem)] rounded-lg border border-stroke-subtle bg-surface-raised p-1 shadow-lg"
          >
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[var(--tracking-caps)] text-content-tertiary">
              {t('workspace.plural')}
            </p>

            {workspaces.map((w) => (
              <Link
                key={w.id}
                to={`/w/${w.slug}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2 no-underline hover:bg-surface-hover"
              >
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white"
                >
                  {w.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-content-primary">
                    {w.name}
                  </span>
                  <span className="block text-xs text-content-tertiary">
                    {t('workspace.memberCount', { count: w.memberCount })}
                  </span>
                </span>
                {w.id === workspace.id && (
                  <Icon name="check" size={15} className="text-brand-600" />
                )}
              </Link>
            ))}

            {/* Other accounts.
                Hidden entirely at a count of one, which is almost everybody —
                a switcher with a single entry is a control that does nothing
                and a question the reader has to answer ("what is an
                organisation?") to find that out. It appears the moment
                somebody accepts an invitation into a second one. */}
            {organizations.length > 1 && (
              <div className="mt-1 border-t border-stroke-subtle pt-1">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[var(--tracking-caps)] text-content-tertiary">
                  {t('organization.plural')}
                </p>

                {organizations.map((org) => (
                  <Form
                    key={org.id}
                    method="post"
                    action="/switch-organization"
                    onSubmit={() => setOpen(false)}
                  >
                    <input type="hidden" name="organizationId" value={org.id} />
                    <button
                      type="submit"
                      role="menuitem"
                      // Switching to where you already are is a no-op that
                      // costs a session rotation, so it is not offered.
                      disabled={org.current}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-start hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-xs font-bold text-content-secondary"
                      >
                        {org.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-content-primary">
                          {org.name}
                        </span>
                        {/* The role here, not on the workspace rows above:
                            it is the whole point. The same person is a manager
                            in one of these and a developer in another, and
                            seeing which is which before switching saves the
                            "why can't I do anything here" moment. */}
                        <span className="block text-xs text-content-tertiary">
                          {t(`roles.${org.role}`)}
                        </span>
                      </span>
                      {org.current && <Icon name="check" size={15} className="text-brand-600" />}
                    </button>
                  </Form>
                ))}
              </div>
            )}

            <div className="mt-1 border-t border-stroke-subtle pt-1">
              {canCreateProject && (
                <Link
                  to={`/w/${workspace.slug}/projects/new`}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-md font-medium text-content-brand no-underline hover:bg-surface-hover"
                >
                  <Icon name="plus" size={15} />
                  {t('projects.new')}
                </Link>
              )}
              <Link
                to="/workspaces/new"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-md font-medium text-content-brand no-underline hover:bg-surface-hover"
              >
                <Icon name="plus" size={15} />
                {t('workspace.create')}
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Nav primitives ─────────────────────────────────────────────────────── */

function NavItem({
  to,
  icon,
  label,
  end,
  onClick,
}: {
  to: string;
  icon: IconName;
  label: string;
  end?: boolean;
  onClick?: () => void;
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        onClick={onClick}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-md font-medium no-underline transition-colors duration-fast',
            isActive
              ? 'bg-surface-sunken text-content-primary'
              : 'text-content-secondary hover:bg-surface-hover hover:text-content-primary',
          )
        }
      >
        <Icon name={icon} size={16} />
        {label}
      </NavLink>
    </li>
  );
}

function SubItem({
  to,
  icon,
  label,
  onClick,
}: {
  to: string;
  icon: IconName;
  label: string;
  onClick?: () => void;
}) {
  return (
    <li>
      <NavLink
        to={to}
        onClick={onClick}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm no-underline',
            isActive
              ? 'font-medium text-content-brand'
              : 'text-content-secondary hover:bg-surface-hover hover:text-content-primary',
          )
        }
      >
        <Icon name={icon} size={13} />
        {label}
      </NavLink>
    </li>
  );
}
