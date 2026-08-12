import { useEffect, useRef } from 'react';
import { Form, useNavigation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '~/components/ui/Icon';
import { cn } from '~/lib/cn';
import { PRIORITIES, TASK_TYPES, type Person } from '~/data/types';

/**
 * Create a task.
 *
 * A native `<dialog>`: the browser supplies the focus trap, Escape to close,
 * the backdrop and the inert background. Every one of those is something we
 * would otherwise write, and three of them are things hand-rolled modals
 * usually get wrong.
 *
 * Open state lives in the URL (`?new=1`) so the New Task button in the project
 * header — which is a link in a different component — can open it without any
 * shared state between them.
 */
/**
 * One field's message, in place.
 *
 * `role="alert"` so a screen reader announces it when it appears — a message
 * that only exists visually is not a message for everyone.
 */
function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <span role="alert" className="mt-1 block text-sm text-danger-700">
      {message}
    </span>
  );
}

export function NewTaskDialog({
  members,
  open,
  errorCode = null,
  issues = null,
}: {
  members: Person[];
  open: boolean;
  /** Set when the server refused. Keeps the dialog open with its values. */
  errorCode?: string | null;
  /** Messages keyed by field name, so each lands under its own input. */
  issues?: Record<string, string[]> | null;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const navigation = useNavigation();
  const [params, setParams] = useSearchParams();
  const actionFailed = Boolean(errorCode);

  /**
   * The message for one field, if the server had something to say about it.
   *
   * Rendered next to the input rather than in a banner at the top. A summary
   * that says "check the highlighted fields" is only useful if something is
   * actually highlighted — and ours was drawn behind the dialog, where it
   * could not be read at all.
   */
  const issueFor = (field: string) => issues?.[field]?.[0] ?? null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const submitting = navigation.state === 'submitting';
  const formRef = useRef<HTMLFormElement>(null);
  const wasSubmitting = useRef(false);

  /**
   * Close and clear once the submission lands — and only then.
   *
   * Closing on click would hide a validation error the person needs to read,
   * so this waits for navigation to return to idle after a submit. The ref
   * tracks that a submit actually happened: without it this fires on every
   * unrelated navigation and closes a dialog the user just opened.
   *
   * `reset()` is required because React keeps the same form element mounted
   * between renders, so the previous values survive unless cleared.
   */
  useEffect(() => {
    if (submitting) {
      wasSubmitting.current = true;
      return;
    }

    if (wasSubmitting.current && navigation.state === 'idle') {
      wasSubmitting.current = false;

      // An action that returned an error left it on screen; leave the dialog
      // open and the values intact so it can be corrected rather than retyped.
      if (actionFailed) return;

      formRef.current?.reset();
      close();
    }
  }, [submitting, navigation.state, actionFailed]);

  function close() {
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const next = new URLSearchParams(params);
          next.set('new', '1');
          setParams(next, { replace: true });
        }}
        className="inline-flex items-center gap-2 rounded-md border border-stroke-subtle bg-surface-raised px-3.5 py-2 text-md font-medium text-content-secondary hover:bg-surface-hover"
      >
        <Icon name="plus" size={15} />
        {t('tasks.new')}
      </button>

      <dialog
        ref={ref}
        onClose={close}
        aria-labelledby="new-task-title"
        className="w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-stroke-subtle bg-surface-raised p-0 text-content-primary shadow-lg backdrop:bg-neutral-950/40"
      >
        <Form method="post" replace ref={formRef}>
          <input type="hidden" name="intent" value="create" />

          <div className="flex items-start justify-between gap-4 border-b border-stroke-subtle px-6 py-4">
            <h2 id="new-task-title" className="text-xl font-semibold">{t('tasks.new')}</h2>
            <button
              type="button"
              onClick={close}
              aria-label={t('common.cancel')}
              className="flex size-8 items-center justify-center rounded-md text-content-tertiary hover:bg-surface-hover"
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="space-y-4 px-6 py-5">
            {errorCode && !issues && (
              <p
                role="alert"
                className="rounded-md border border-danger-500 bg-danger-50 px-3 py-2.5 text-md text-danger-700"
              >
                {t(`errors.${errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
              </p>
            )}
            <label className="block">
              <span className="text-md font-medium">{t('tasks.title')}</span>
              <input
                name="title"
                required
                maxLength={200}
                autoFocus
                aria-invalid={Boolean(issueFor('title'))}
                placeholder={t('tasks.titlePlaceholder')}
                className={cn('field mt-1.5', issueFor('title') && 'border-danger-500')}
              />
              <FieldError message={issueFor('title')} />
            </label>

            <label className="block">
              <span className="text-md font-medium">{t('tasks.description')}</span>
              <textarea
                name="description"
                rows={3}
                maxLength={4000}
                placeholder={t('tasks.descriptionPlaceholder')}
                className="field mt-1.5"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-md font-medium">{t('tasks.type')}</span>
                <select name="type" defaultValue="TASK" className="mt-1.5 field text-md ">
                  {TASK_TYPES.map((v) => <option key={v} value={v}>{t(`taskType.${v}`)}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-md font-medium">{t('tasks.priority')}</span>
                <select name="priority" defaultValue="MEDIUM" className="mt-1.5 field text-md ">
                  {PRIORITIES.map((v) => <option key={v} value={v}>{t(`priority.${v}`)}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-md font-medium">{t('tasks.assignee')}</span>
                <select
                  name="assigneeId"
                  defaultValue=""
                  aria-invalid={Boolean(issueFor('assigneeId'))}
                  className={cn('field mt-1.5', issueFor('assigneeId') && 'border-danger-500')}
                >
                  <option value="">{t('tasks.unassigned')}</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <FieldError message={issueFor('assigneeId')} />
                {members.length === 0 && (
                  <span className="mt-1 block text-sm text-content-tertiary">
                    {t('tasks.noMembersYet')}
                  </span>
                )}
              </label>

              <label className="block">
                <span className="text-md font-medium">{t('tasks.dueDate')}</span>
                <input
                  type="date"
                  name="dueDate"
                  aria-invalid={Boolean(issueFor('dueDate'))}
                  className={cn('field mt-1.5', issueFor('dueDate') && 'border-danger-500')}
                />
                <FieldError message={issueFor('dueDate')} />
              </label>

              <label className="block sm:col-span-2">
                <span className="text-md font-medium">{t('tasks.estimateHours')}</span>
                <input
                  type="number"
                  name="estimateHours"
                  min={0}
                  max={500}
                  step={0.5}
                  className={cn('field mt-1.5', issueFor('estimateHours') && 'border-danger-500')}
                  data-x=""
                />
                <FieldError message={issueFor('estimateHours')} />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-stroke-subtle px-6 py-4">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-stroke-subtle px-4 py-2.5 text-md font-medium text-content-secondary hover:bg-surface-hover"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary"
            >
              {submitting ? t('common.loading') : t('tasks.create')}
            </button>
          </div>
        </Form>
      </dialog>
    </>
  );
}
