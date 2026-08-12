import { Form, Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects.$key.board';
import { Card, PriorityChip, TypeChip } from '~/components/ui/Card';
import { Icon } from '~/components/ui/Icon';
import { getProject, listTasks, updateTaskStatus } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { toErrorCode } from '~/lib/api.server';
import { TASK_STATUSES, isOverdue } from '~/data/types';

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const project = await getProject(request, params.key!);

  // A client who is not allowed the board cannot reach it by URL either.
  if (user.role === 'CLIENT' && !project.visibility.showBoard) {
    throw new Response('Not Found', { status: 404 });
  }

  const tasks = await listTasks(request, params.key!);

  return {
    slug: params.slug!,
    canMove: user.role !== 'CLIENT',
    viewerId: user.id,
    isManager: user.role === 'PROJECT_MANAGER',
    columns: TASK_STATUSES.map((status) => ({
      status,
      tasks: tasks.filter((t) => t.status === status),
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  try {
    await updateTaskStatus(
      request,
      String(form.get('taskKey')),
      String(form.get('status')) as never,
      String(form.get('blockedReason') ?? '') || undefined,
    );
  } catch (error) {
    return { errorCode: toErrorCode(error) };
  }
  return { ok: true as const };
}

/**
 * The board.
 *
 * Movement is a `<select>` on each card, not drag and drop. That is a
 * deliberate first version: dragging is a mouse-only gesture that needs a
 * keyboard equivalent built alongside it anyway, and a select is the keyboard
 * equivalent. Drag can be layered on top later without changing what happens
 * underneath — the same form submits either way.
 */
export default function Board({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const d = loaderData;

  return (
    <div className="space-y-4">
      {actionData && 'errorCode' in actionData && actionData.errorCode && (
        <p className="rounded-md border border-danger-500 bg-danger-50 px-4 py-3 text-md text-danger-700">
          {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {d.columns.map((column) => (
          <section key={column.status} aria-label={t(`status.${column.status}`)} className="min-w-0">
            <div className="mb-3 flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: `var(--status-${column.status.toLowerCase().replace('_', '-')})` }}
              />
              <h2 className="text-md font-semibold text-content-primary">
                {t(`status.${column.status}`)}
              </h2>
              <span className="ms-auto rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-bold text-content-secondary">
                {column.tasks.length}
              </span>
            </div>

            <ul className="space-y-2">
              {column.tasks.length === 0 && (
                <li className="rounded-lg border border-dashed border-stroke-subtle px-3 py-6 text-center text-sm text-content-tertiary">
                  {t('board.empty')}
                </li>
              )}

              {column.tasks.map((task) => (
                <li key={task.id}>
                  <Card className="p-3">
                    <Link
                      to={`/w/${d.slug}/tasks/${task.key}`}
                      className="block text-md font-medium text-content-primary no-underline hover:underline"
                    >
                      {task.title}
                    </Link>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <TypeChip type={task.type} />
                      <PriorityChip priority={task.priority} />
                    </div>

                    {task.blockedReason && (
                      <p className="mt-2 rounded-md bg-danger-50 px-2 py-1.5 text-sm text-danger-700">
                        {task.blockedReason}
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-content-tertiary">{task.key}</span>
                      <div className="flex items-center gap-2">
                        {isOverdue(task) && (
                          <Icon name="alertTriangle" size={13} className="text-danger-600" label={t('dashboard.overdue')} />
                        )}
                        {task.assignee && (
                          <span
                            title={task.assignee!.name}
                            className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                            style={{ background: task.assignee!.avatarColor }}
                          >
                            {task.assignee!.initials}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Same rule as the table: a manager moves anything, a
                        developer moves only their own, and DONE is a manager's
                        approval rather than a status anyone can select. */}
                    {d.canMove && (d.isManager || task.assigneeId === d.viewerId) && (
                      <Form method="post" className="mt-3">
                        <input type="hidden" name="taskKey" value={task.key} />
                        <label className="sr-only" htmlFor={`move-${task.id}`}>
                          {t('board.moveTo')}
                        </label>
                        <select
                          id={`move-${task.id}`}
                          name="status"
                          defaultValue={task.status}
                          onChange={(e) => e.currentTarget.form?.requestSubmit()}
                          className="select-sm w-full bg-surface-canvas"
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
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
