import { Form, Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects.$key.tasks';
import { Card, EmptyState, PriorityChip, StatusChip, TypeChip } from '~/components/ui/Card';
import { Icon } from '~/components/ui/Icon';
import { NewTaskDialog } from '~/components/tasks/NewTaskDialog';
import {
  createTask,
  getProject,
  listMembers,
  listTasks,
  updateTaskStatus,
} from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { formatDate, daysUntil } from '~/lib/format';
import { PRIORITIES, TASK_STATUSES, TASK_TYPES, isOverdue } from '~/data/types';
import { ApiError, toErrorCode } from '~/lib/api.server';

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const isClient = user.role === 'CLIENT';

  const [project, tasks, members] = await Promise.all([
    getProject(request, params.key!),
    listTasks(request, params.key!, {
      status: url.searchParams.get('status') ?? undefined,
      type: url.searchParams.get('type') ?? undefined,
      priority: url.searchParams.get('priority') ?? undefined,
      assignee: url.searchParams.get('assignee') ?? undefined,
    }),
    // Members, not `assignable`. Assignable is everyone who could be *added*
    // to the project — the exact people the API refuses to assign work to.
    // Offering them in this dropdown made every assignment fail validation.
    isClient ? Promise.resolve([]) : listMembers(request, params.key!),
  ]);

  return {
    slug: params.slug!,
    projectKey: project.key,
    canEdit: !isClient,
    // Who is asking, so a row can tell whether this person may move *that*
    // task. A developer may move their own work and nobody else's, and only a
    // manager may mark anything done — both enforced in the API, and both
    // previously offered to everyone in this table regardless.
    viewerId: user.id,
    isManager: user.role === 'PROJECT_MANAGER',
    showAssignees: !isClient || project.visibility.showAssignees,
    showDueDates: !isClient || project.visibility.showDueDates,
    members,
    // The API already attaches the assignee; a client's copy is already
    // redacted according to the project's settings.
    tasks,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get('intent'));

  try {
    if (intent === 'status') {
      await updateTaskStatus(
        request,
        String(form.get('taskKey')),
        String(form.get('status')) as never,
        String(form.get('blockedReason') ?? '') || undefined,
      );
      return { ok: true as const };
    }

    if (intent === 'create') {
      const due = String(form.get('dueDate') ?? '');
      const estimate = String(form.get('estimateHours') ?? '');

      await createTask(request, params.key!, {
        title: String(form.get('title') ?? '').trim(),
        description: String(form.get('description') ?? '') || undefined,
        type: String(form.get('type') ?? 'TASK') as never,
        priority: String(form.get('priority') ?? 'MEDIUM') as never,
        assigneeId: String(form.get('assigneeId') ?? '') || null,
        dueDate: due || null,
        estimateHours: estimate ? Number(estimate) : null,
      });
      return { ok: true as const };
    }
  } catch (error) {
    // The API returns issues keyed by field name. Passing them through lets
    // the dialog put each message under the input it belongs to, instead of
    // a banner behind the dialog telling you to check highlighted fields
    // that were never highlighted.
    return {
      errorCode: toErrorCode(error),
      issues: error instanceof ApiError ? error.fieldIssues : null,
    };
  }

  return { ok: true as const };
}

export default function TasksTab({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const d = loaderData;

  return (
    <div className="space-y-4">
      <Form method="get" className="flex flex-wrap gap-3">
        <FilterSelect name="status" label={t('tasks.allStatuses')} options={TASK_STATUSES.map((s) => [s, t(`status.${s}`)])} />
        <FilterSelect name="type" label={t('tasks.allTypes')} options={TASK_TYPES.map((s) => [s, t(`taskType.${s}`)])} />
        <FilterSelect name="priority" label={t('tasks.allPriorities')} options={PRIORITIES.map((s) => [s, t(`priority.${s}`)])} />
        {d.showAssignees && (
          <FilterSelect
            name="assignee"
            label={t('tasks.allAssignees')}
            options={[
              ['UNASSIGNED', t('tasks.unassigned')] as [string, string],
              ...d.members.map((m) => [m.id, m.name] as [string, string]),
            ]}
          />
        )}
        <noscript>
          <button type="submit" className="h-10 rounded-full border border-stroke-subtle px-4 text-md">
            {t('common.apply')}
          </button>
        </noscript>
      </Form>

      {d.canEdit && (
        <NewTaskDialog
          members={d.members}
          open={params.get('new') === '1'}
          errorCode={actionData && 'errorCode' in actionData ? actionData.errorCode : null}
          issues={actionData && 'issues' in actionData ? actionData.issues : null}
        />
      )}

      <Card className="overflow-hidden">
        {d.tasks.length === 0 ? (
          <EmptyState icon="checkSquare" title={t('tasks.none')} hint={t('tasks.noneHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-start">
              <thead>
                <tr className="border-b border-stroke-subtle bg-surface-sunken/60">
                  <Th>{t('tasks.title')}</Th>
                  <Th>{t('tasks.type')}</Th>
                  <Th>{t('tasks.priority')}</Th>
                  <Th>{t('tasks.status')}</Th>
                  {d.showAssignees && <Th>{t('tasks.assignee')}</Th>}
                  {d.showDueDates && <Th>{t('tasks.dueDate')}</Th>}
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-subtle)]">
                {d.tasks.map((task) => {
                  const overdue = isOverdue(task);
                  const due = task.dueDate ? daysUntil(task.dueDate) : null;

                  return (
                    <tr key={task.id} className="hover:bg-surface-hover">
                      <td className="px-4 py-3">
                        <Link
                          to={`/w/${d.slug}/tasks/${task.key}`}
                          className="font-medium text-content-primary no-underline hover:underline"
                        >
                          {task.title}
                        </Link>
                        <span className="ms-2 font-mono text-xs text-content-tertiary">{task.key}</span>
                        {!task.clientVisible && (
                          <span
                            title={t('visibility.hiddenFromClient')}
                            className="ms-2 inline-flex items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-content-tertiary"
                          >
                            <Icon name="eyeOff" size={11} />
                            {t('visibility.hidden')}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3"><TypeChip type={task.type} /></td>
                      <td className="px-4 py-3"><PriorityChip priority={task.priority} /></td>

                      <td className="px-4 py-3">
                        {/* A manager moves anything; a developer moves only
                            what is theirs. The API has always refused the rest,
                            so offering the dropdown on someone else's row was
                            offering a control that answers "you can only change
                            the status of tasks assigned to you". */}
                        {d.canEdit && (d.isManager || task.assigneeId === d.viewerId) ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="status" />
                            <input type="hidden" name="taskKey" value={task.key} />
                            {/* BLOCKED needs a reason, which a dropdown cannot
                                collect — so it is only offered on the detail
                                screen, where there is somewhere to type it.

                                DONE is a manager's decision: it is the approval
                                gate at the end of the workflow, and the API
                                answers PM_APPROVAL_REQUIRED to anyone else. */}
                            <select
                              name="status"
                              defaultValue={task.status}
                              aria-label={t('tasks.status')}
                              onChange={(e) => e.currentTarget.form?.requestSubmit()}
                              className="select-sm bg-surface-raised"
                            >
                              {TASK_STATUSES.filter(
                                (s) =>
                                  (s !== 'BLOCKED' || task.status === 'BLOCKED') &&
                                  (s !== 'DONE' || d.isManager || task.status === 'DONE'),
                              ).map((s) => (
                                <option key={s} value={s}>{t(`status.${s}`)}</option>
                              ))}
                            </select>
                          </Form>
                        ) : (
                          <StatusChip status={task.status} />
                        )}
                      </td>

                      {d.showAssignees && (
                        <td className="px-4 py-3">
                          {task.assignee ? (
                            <span className="inline-flex items-center gap-2">
                              <span
                                aria-hidden
                                className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                                style={{ background: task.assignee!.avatarColor }}
                              >
                                {task.assignee!.initials}
                              </span>
                              <span className="text-md text-content-primary">{task.assignee!.name}</span>
                            </span>
                          ) : (
                            <span className="text-md text-content-tertiary">{t('tasks.unassigned')}</span>
                          )}
                        </td>
                      )}

                      {d.showDueDates && (
                        <td className="px-4 py-3">
                          <span
                            className={
                              overdue
                                ? 'inline-flex items-center gap-1.5 text-md font-medium text-danger-600'
                                : 'inline-flex items-center gap-1.5 text-md text-content-secondary'
                            }
                          >
                            <Icon name={overdue ? 'alertTriangle' : 'calendar'} size={13} />
                            {formatDate(task.dueDate, i18n.language)}
                            {due !== null && due >= 0 && due <= 2 && !overdue && (
                              <span className="text-xs text-warning-700">{t('tasks.dueSoon')}</span>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-[var(--tracking-caps)] text-content-tertiary">
      {children}
    </th>
  );
}

function FilterSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: [string, string][];
}) {
  const [params] = useSearchParams();

  return (
    <select
      name={name}
      defaultValue={params.get(name) ?? 'ALL'}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="select-pill"
    >
      <option value="ALL">{label}</option>
      {options.map(([value, text]) => (
        <option key={value} value={value}>{text}</option>
      ))}
    </select>
  );
}
