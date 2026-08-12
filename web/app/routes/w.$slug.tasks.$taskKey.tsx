import { Form, Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.tasks.$taskKey';
import { Card, CardHeader, PriorityChip, ProgressBar, StatusChip, TypeChip } from '~/components/ui/Card';
import { ConfirmButton } from '~/components/ui/ConfirmButton';
import { Icon } from '~/components/ui/Icon';
import {
  addComment,
  createTask,
  deleteComment,
  getTask,
  listComments,
  listMembers as listProjectMembers,
  updateTask,
  updateTaskStatus,
} from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { ApiError, toErrorCode } from '~/lib/api.server';
import { formatFullDate, formatRelative } from '~/lib/format';
import { PRIORITIES, TASK_STATUSES, TASK_TYPES, isOverdue, type Comment as CommentRow, type Person, type Task } from '~/data/types';

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const isClient = user.role === 'CLIENT';
  const isManager = user.role === 'PROJECT_MANAGER';

  // A hidden task is a 404 from the API for a client, which `callApi` raises
  // and the error boundary renders. Nothing here decides visibility.
  const task = await getTask(request, params.taskKey!);
  const projectKey = task.key.split('-')[0]!;

  const [comments, members] = await Promise.all([
    listComments(request, task.key),

    // Two bugs lived in this one line.
    //
    // The gate asked "is this a client", but the endpoint is managers-only —
    // so a *developer* opening any task called it, was refused with
    // "This action requires: PROJECT_MANAGER", and got a stack trace instead
    // of the task. Every developer, every task.
    //
    // And it fetched the wrong list. `assignable` is everyone in the
    // organisation who is *not* on the project — the "add somebody" list. The
    // assignee dropdown needs the opposite: people who are on it. Picking a
    // name from the old list produced a task assigned to someone who could not
    // open it, which the API refuses.
    isManager ? listProjectMembers(request, projectKey) : Promise.resolve([]),
  ]);

  return {
    slug: params.slug!,
    task,
    project: task.project ?? { key: projectKey, name: projectKey, visibility: null },
    isClient,
    canEdit: !isClient,
    canAssign: isManager,
    viewerId: user.id,
    subtasks: task.subtasks ?? [],
    members,
    // Internal comments are already absent for a client — filtered in the API
    // query, not stripped here.
    comments,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const key = params.taskKey!;
  const form = await request.formData();
  const intent = String(form.get('intent'));

  try {
    if (intent === 'status') {
      await updateTaskStatus(
        request,
        key,
        String(form.get('status')) as never,
        String(form.get('blockedReason') ?? '') || undefined,
      );
    } else if (intent === 'deleteComment') {
      await deleteComment(request, String(form.get('commentId') ?? ''));
    } else if (intent === 'comment') {
      const body = String(form.get('body') ?? '').trim();
      if (body) await addComment(request, key, body, form.get('isInternal') === 'on');
    } else if (intent === 'subtask') {
      const title = String(form.get('title') ?? '').trim();
      if (title) {
        // Subtasks inherit the parent's priority and land on the person
        // creating them — the developer splitting up their own work.
        await createTask(request, key.split('-')[0]!, {
          title,
          type: 'TASK',
          priority: String(form.get('priority') ?? 'MEDIUM') as never,
          parentId: String(form.get('parentId') ?? '') || null,
        });
      }
    } else if (intent === 'visibility') {
      await updateTask(request, key, { clientVisible: form.get('clientVisible') === 'on' });
    } else if (intent === 'details') {
      // Title, type, priority, due date and estimate. The API has accepted
      // these since the endpoint was written; nothing on any screen sent them,
      // so a due date could be set at creation and never corrected.
      const due = String(form.get('dueDate') ?? '');
      const estimate = String(form.get('estimateHours') ?? '');

      await updateTask(request, key, {
        title: String(form.get('title') ?? '').trim(),
        description: String(form.get('description') ?? ''),
        type: String(form.get('type')) as never,
        priority: String(form.get('priority')) as never,
        dueDate: due || null,
        estimateHours: estimate ? Number(estimate) : null,
      });
    } else if (intent === 'assign') {
      await updateTask(request, key, {
        assigneeId: String(form.get('assigneeId') ?? '') || null,
      });
    }
  } catch (error) {
    return {
      errorCode: toErrorCode(error),
      issues: error instanceof ApiError ? error.fieldIssues : null,
    };
  }

  return { ok: true as const };
}

export default function TaskDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const d = loaderData;
  const { task } = d;
  const doneSubtasks = d.subtasks.filter((s: Task) => s.status === 'DONE').length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          to={`/w/${d.slug}/projects/${d.project.key}/tasks`}
          aria-label={t('common.back')}
          className="flex size-8 items-center justify-center rounded-md text-content-secondary no-underline hover:bg-surface-hover"
        >
          <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" />
        </Link>
        <span className="font-mono text-md text-content-tertiary">{task.key}</span>
        <StatusChip status={task.status} />
        <PriorityChip priority={task.priority} />
        <TypeChip type={task.type} />
        {!task.clientVisible && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs font-medium text-content-secondary">
            <Icon name="eyeOff" size={12} />
            {t('visibility.hiddenFromClient')}
          </span>
        )}
      </header>

      {actionData && 'errorCode' in actionData && actionData.errorCode && (
        <p className="rounded-md border border-danger-500 bg-danger-50 px-4 py-3 text-md text-danger-700">
          {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="p-card">
            <h1 className="text-2xl font-bold text-content-primary">{task.title}</h1>

            {task.blockedReason && (
              <p className="mt-4 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-md text-danger-700">
                <Icon name="alertTriangle" size={15} className="mt-0.5 shrink-0" />
                {task.blockedReason}
              </p>
            )}

            {task.description ? (
              // Markdown rendered as plain text with line breaks preserved.
              // Rendering it as HTML needs a sanitiser, and an unsanitised
              // description is a stored-XSS hole in a product where clients
              // can type. The sanitiser comes with the editor, not before it.
              <p className="mt-4 whitespace-pre-wrap text-md leading-[var(--leading-relaxed)] text-content-secondary">
                {task.description}
              </p>
            ) : (
              <p className="mt-4 text-md text-content-tertiary">{t('tasks.noDescription')}</p>
            )}
          </Card>

          {/* Subtasks */}
          <Card>
            <CardHeader
              title={
                d.subtasks.length > 0
                  ? `${t('tasks.subtasks')} · ${doneSubtasks}/${d.subtasks.length}`
                  : t('tasks.subtasks')
              }
            />

            {d.subtasks.length > 0 && (
              <div className="px-card pt-4">
                <ProgressBar value={(doneSubtasks / d.subtasks.length) * 100} label={t('tasks.subtaskProgress')} />
              </div>
            )}

            <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
              {d.subtasks.length === 0 && (
                <li className="px-card py-6 text-center text-md text-content-tertiary">{t('tasks.noSubtasks')}</li>
              )}
              {d.subtasks.map((sub: Task) => (
                <li key={sub.id} className="flex items-center gap-3 px-card py-3">
                  <Icon
                    name={sub.status === 'DONE' ? 'checkCircle' : 'circle'}
                    size={16}
                    className={sub.status === 'DONE' ? 'text-success-600' : 'text-content-tertiary'}
                  />
                  <Link to={`/w/${d.slug}/tasks/${sub.key}`} className="min-w-0 flex-1 text-md text-content-primary no-underline hover:underline">
                    {sub.title}
                  </Link>
                  <StatusChip status={sub.status} />
                </li>
              ))}
            </ul>

            {d.canEdit && (
              <Form method="post" className="flex gap-2 border-t border-stroke-subtle p-card">
                <input type="hidden" name="intent" value="subtask" />
                <input type="hidden" name="parentId" value={task.id} />
                <input
                  name="title"
                  required
                  maxLength={200}
                  placeholder={t('tasks.addSubtask')}
                  className="field flex-1"
                />
                <button type="submit" className="rounded-md bg-brand-600 px-4 text-md font-semibold text-white hover:bg-brand-700">
                  {t('common.add')}
                </button>
              </Form>
            )}
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader title={`${t('tasks.comments')} · ${d.comments.length}`} />

            <ul className="divide-y divide-[var(--border-subtle)]">
              {d.comments.length === 0 && (
                <li className="px-card py-6 text-center text-md text-content-tertiary">{t('tasks.noComments')}</li>
              )}
              {d.comments.map((comment: CommentRow) => (
                <li key={comment.id} className={comment.isInternal ? 'bg-warning-50/40 px-card py-4' : 'px-card py-4'}>
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="flex size-7 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: comment.author!.avatarColor }}>
                      {comment.author!.initials}
                    </span>
                    <span className="text-md font-medium text-content-primary">{comment.author!.name}</span>
                    <span className="text-sm text-content-tertiary">
                      {formatRelative(comment.createdAt, i18n.language)}
                    </span>
                    {comment.isInternal && (
                      <span className="ms-auto inline-flex items-center gap-1 rounded-md bg-warning-100 px-2 py-0.5 text-xs font-semibold text-warning-700">
                        <Icon name="lock" size={11} />
                        {t('tasks.internal')}
                      </span>
                    )}

                    {/* Yours, or anyone's if you run the project — the same
                        rule the API enforces, so the button is never offered
                        where it would be refused. Soft-deleted server-side, so
                        a reply that referred to it still reads sensibly. */}
                    {(comment.authorId === d.viewerId || d.canAssign) && (
                      <Form method="post" replace className={comment.isInternal ? 'ms-2' : 'ms-auto'}>
                        <input type="hidden" name="intent" value="deleteComment" />
                        <input type="hidden" name="commentId" value={comment.id} />
                        <ConfirmButton
                          variant="danger"
                          title={t('tasks.deleteCommentTitle')}
                          message={t('tasks.deleteCommentBody')}
                        >
                          {t('common.delete')}
                        </ConfirmButton>
                      </Form>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-md text-content-secondary">{comment.body}</p>
                </li>
              ))}
            </ul>

            <Form method="post" className="space-y-3 border-t border-stroke-subtle p-card">
              <input type="hidden" name="intent" value="comment" />
              <textarea
                name="body"
                rows={3}
                required
                maxLength={4000}
                placeholder={t('tasks.commentPlaceholder')}
                className="field mt-1.5"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* A client never sees this checkbox, and the gateway also
                    refuses an internal comment from a client whatever is
                    posted — the UI is the convenience, not the guard. */}
                {d.canEdit && (
                  <label className="inline-flex items-center gap-2 text-md text-content-secondary">
                    <input type="checkbox" name="isInternal" />
                    {t('tasks.markInternal')}
                    <span className="text-sm text-content-tertiary">{t('tasks.markInternalHint')}</span>
                  </label>
                )}
                <button type="submit" className="ms-auto btn-primary">
                  <Icon name="send" size={15} className="rtl:-scale-x-100" />
                  {t('tasks.comment')}
                </button>
              </div>
            </Form>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('tasks.details')} />

            {d.canEdit ? (
              <Form method="post" className="space-y-4 p-card">
                <input type="hidden" name="intent" value="details" />

                <label className="block">
                  <span className="text-md font-medium">{t('tasks.title')}</span>
                  <input name="title" defaultValue={task.title} required maxLength={200} className="field mt-1.5" />
                </label>

                <label className="block">
                  <span className="text-md font-medium">{t('tasks.description')}</span>
                  <textarea
                    name="description"
                    rows={4}
                    maxLength={8000}
                    defaultValue={task.description ?? ''}
                    className="field mt-1.5"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-md font-medium">{t('tasks.type')}</span>
                    <select name="type" defaultValue={task.type} className="field mt-1.5">
                      {TASK_TYPES.map((v) => <option key={v} value={v}>{t(`taskType.${v}`)}</option>)}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-md font-medium">{t('tasks.priority')}</span>
                    <select name="priority" defaultValue={task.priority} className="field mt-1.5">
                      {PRIORITIES.map((v) => <option key={v} value={v}>{t(`priority.${v}`)}</option>)}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-md font-medium">{t('tasks.dueDate')}</span>
                    <input
                      type="date"
                      name="dueDate"
                      defaultValue={task.dueDate ? task.dueDate.slice(0, 10) : ''}
                      className="field mt-1.5"
                    />
                  </label>

                  <label className="block">
                    <span className="text-md font-medium">{t('tasks.estimateHours')}</span>
                    <input
                      type="number"
                      name="estimateHours"
                      min={0}
                      max={500}
                      step={0.5}
                      defaultValue={task.estimateHours ?? ''}
                      className="field mt-1.5"
                    />
                  </label>
                </div>

                <button type="submit" className="btn-primary w-full">
                  <Icon name="save" size={15} />
                  {t('common.saveChanges')}
                </button>
              </Form>
            ) : (
              <dl className="space-y-3 p-card text-md">
                <Row label={t('tasks.project')}>{d.project.name}</Row>
                <Row label={t('tasks.assignee')}>{task.assignee?.name ?? t('tasks.unassigned')}</Row>
                <Row label={t('tasks.dueDate')}>
                  <span className={isOverdue(task) ? 'font-medium text-danger-600' : undefined}>
                    {formatFullDate(task.dueDate, i18n.language)}
                  </span>
                </Row>
              </dl>
            )}
          </Card>

          {d.canEdit && (
            <Card>
              <CardHeader title={t('tasks.actions')} />
              <div className="space-y-4 p-card">
                {/* Only offered to someone the API will accept it from: a
                    manager, or the developer this task belongs to. BLOCKED
                    stays available here — unlike the table and board, this
                    screen has somewhere to type the reason. */}
                {(d.canAssign || task.assigneeId === d.viewerId) && (
                <Form method="post" className="space-y-2">
                  <input type="hidden" name="intent" value="status" />
                  <label className="block text-md font-medium">{t('tasks.status')}</label>
                  <select name="status" defaultValue={task.status} className="field text-md ">
                    {TASK_STATUSES.filter(
                      // DONE is the manager's approval at the end of the
                      // workflow. A developer moves work to IN_REVIEW and stops.
                      (s) => s !== 'DONE' || d.canAssign || task.status === 'DONE',
                    ).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                  </select>
                  {/* Always present, because BLOCKED is refused without one —
                      showing the field only after the refusal would mean
                      losing the selection to get to it. */}
                  <input
                    name="blockedReason"
                    defaultValue={task.blockedReason ?? ''}
                    maxLength={280}
                    placeholder={t('tasks.blockedReasonPlaceholder')}
                    className="field text-md "
                  />
                  <button type="submit" className="w-full rounded-md border border-stroke-subtle py-2 text-md font-medium hover:bg-surface-hover">
                    {t('tasks.updateStatus')}
                  </button>
                </Form>
                )}

                {/* Only a project manager staffs work, and only they have the
                    list — a developer's `members` is empty, so rendering this
                    for them would be a dropdown with one option reading
                    "Unassigned" that unassigns the task on first touch. */}
                {d.canAssign && (
                  <Form method="post" className="space-y-2">
                    <input type="hidden" name="intent" value="assign" />
                    <label className="block text-md font-medium">{t('tasks.assignee')}</label>
                    <select
                      name="assigneeId"
                      defaultValue={task.assigneeId ?? ''}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className="field text-md "
                    >
                      <option value="">{t('tasks.unassigned')}</option>
                      {d.members.map((m: Person) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </Form>
                )}

                <Form method="post" className="border-t border-stroke-subtle pt-4">
                  <input type="hidden" name="intent" value="visibility" />
                  <label className="flex items-start gap-2 text-md">
                    <input
                      type="checkbox"
                      name="clientVisible"
                      defaultChecked={task.clientVisible}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium text-content-primary">{t('visibility.visibleToClient')}</span>
                      <span className="block text-sm text-content-tertiary">{t('visibility.perTaskHint')}</span>
                    </span>
                  </label>
                </Form>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-content-tertiary">{label}</dt>
      <dd className="text-end font-medium text-content-primary">{children}</dd>
    </div>
  );
}
