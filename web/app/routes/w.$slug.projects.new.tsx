import { Form, Link, redirect, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects.new';
import { Card, CardHeader } from '~/components/ui/Card';
import { Icon } from '~/components/ui/Icon';
import { createProject, getWorkspace } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { toErrorCode } from '~/lib/api.server';
import { PRIORITIES, type Person } from '~/data/types';

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (user.role !== 'PROJECT_MANAGER') throw new Response('Not Found', { status: 404 });

  // Team is added from project settings once the project exists — the API's
  // assignable list is scoped to a project, so there is nothing to offer here.
  return {
    slug: params.slug!,
    workspace: await getWorkspace(request, params.slug!),
    };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (user.role !== 'PROJECT_MANAGER') throw new Response('Not Found', { status: 404 });

  const workspace = await getWorkspace(request, params.slug!);
  const form = await request.formData();
  const start = String(form.get('startDate') ?? '');
  const end = String(form.get('endDate') ?? '');

  // Dates are validated here rather than trusted from the picker: a date input
  // can be typed into, and "end before start" is the one a person actually hits.
  if (start && end && new Date(end) < new Date(start)) {
    return { errorCode: 'END_BEFORE_START' };
  }

  // The invite rows, paired by position and with the empty ones dropped. The
  // form always renders three, and leaving all three blank is the normal case.
  const emails = form.getAll('inviteEmail').map((v) => String(v).trim());
  const roles = form.getAll('inviteRole').map(String);

  const invites = emails
    .map((email, i) => ({ email, role: (roles[i] ?? 'DEVELOPER') as Person['role'] }))
    .filter((entry) => entry.email !== '');

  try {
    const { project, invitations } = await createProject(request, {
      workspaceId: workspace.id,
      key: String(form.get('key') ?? ''),
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim(),
      priority: String(form.get('priority') ?? 'MEDIUM') as never,
      startDate: start ? new Date(start).toISOString() : null,
      endDate: end ? new Date(end).toISOString() : null,
      leadId: String(form.get('leadId') ?? '') || null,
      memberIds: form.getAll('memberIds').map(String),
      visibility: { preset: String(form.get('preset') ?? 'OPEN') as never },
      invites,
    });

    // Invited someone? Land on settings, where the pending list is. That list
    // is the report — live, and correct a minute later — rather than a
    // one-shot "3 invitations sent" banner that says nothing about whether one
    // of the three bounced. Otherwise straight into the project, because you
    // created it in order to work in it.
    const somethingWasSent = invitations.length > 0;

    return redirect(
      somethingWasSent
        ? `/w/${params.slug}/projects/${project.key}/settings`
        : `/w/${params.slug}/projects/${project.key}/tasks`,
    );
  } catch (error) {
    return { errorCode: toErrorCode(error) };
  }
}

/**
 * Create a project.
 *
 * A page rather than a modal, because of the third section. Deciding what a
 * client sees is not a field you skim past in a dialog, and it is not
 * skippable — "set it up later" means never, and the default gets discovered
 * by a client.
 */
export default function NewProject({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { slug, workspace } = loaderData;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <Link
          to={`/w/${slug}/projects`}
          aria-label={t('common.back')}
          className="flex size-8 items-center justify-center rounded-md text-content-secondary no-underline hover:bg-surface-hover"
        >
          <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-content-primary">{t('projects.createTitle')}</h1>
          <p className="text-md text-content-secondary">
            {t('projects.inWorkspace')} <span className="font-medium text-content-brand">{workspace.name}</span>
          </p>
        </div>
      </header>

      {actionData?.errorCode && (
        <p role="alert" className="rounded-md border border-danger-500 bg-danger-50 px-4 py-3 text-md text-danger-700">
          {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
        </p>
      )}

      <Form method="post" className="space-y-6">
        <Card>
          <CardHeader title={t('projects.stepDetails')} />
          <div className="space-y-4 p-card">
            <label className="block">
              <span className="text-md font-medium">{t('projects.name')}</span>
              <input name="name" required maxLength={120} placeholder={t('projects.namePlaceholder')} className="mt-1.5 field text-md " />
            </label>

            <label className="block">
              <span className="text-md font-medium">{t('projects.key')}</span>
              <input
                name="key"
                required
                maxLength={6}
                pattern="[A-Za-z]+"
                placeholder="WEB"
                onInput={(e) => {
                  // Upper-cased as you type, so the field cannot be in a state
                  // the server would reject.
                  const el = e.currentTarget;
                  const start = el.selectionStart;
                  el.value = el.value.toUpperCase().replace(/[^A-Z]/g, '');
                  el.setSelectionRange(start, start);
                }}
                className="mt-1.5 field font-mono text-md uppercase "
              />
              <span className="mt-1 block text-sm text-content-tertiary">{t('projects.keyHint')}</span>
            </label>

            <label className="block">
              <span className="text-md font-medium">{t('settings.description')}</span>
              <textarea name="description" rows={3} maxLength={1000} placeholder={t('projects.descriptionPlaceholder')} className="field mt-1.5" />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-md font-medium">{t('tasks.priority')}</span>
                <select name="priority" defaultValue="MEDIUM" className="mt-1.5 field text-md ">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-md font-medium">{t('settings.startDate')}</span>
                <input type="date" name="startDate" className="mt-1.5 field text-md " />
              </label>
              <label className="block">
                <span className="text-md font-medium">{t('settings.endDate')}</span>
                <input type="date" name="endDate" className="mt-1.5 field text-md " />
              </label>
            </div>
          </div>
        </Card>


        <Card>
          <CardHeader title={t('projects.stepVisibility')} />
          <fieldset className="space-y-2 p-card">
            <legend className="sr-only">{t('projects.stepVisibility')}</legend>
            {(['OPEN', 'SUMMARY', 'CUSTOM'] as const).map((preset, i) => (
              <label key={preset} className="flex cursor-pointer items-start gap-3 rounded-md border border-stroke-subtle p-3 hover:bg-surface-hover">
                <input type="radio" name="preset" value={preset} defaultChecked={i === 0} className="mt-1" />
                <span>
                  <span className="block text-md font-medium text-content-primary">{t(`visibility.${preset}`)}</span>
                  <span className="block text-sm text-content-tertiary">{t(`visibility.${preset}Hint`)}</span>
                </span>
              </label>
            ))}

            <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-3 py-2.5 text-sm text-content-secondary">
              <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
              {t('visibility.internalRule')}
            </p>
          </fieldset>
        </Card>

        {/* ── Who is on it ─────────────────────────────────────────────────
            Three rows, all optional. The API has accepted up to 25 invitations
            at creation since M1 and nothing ever sent one, so a PM's first act
            after making a project was always to go and find the invite screen.

            Three rather than one, because a project starts with a client and at
            least one developer far more often than with nobody; and rather than
            twenty-five, because a form that renders twenty-five empty rows is
            asking you to fill them in. More can be added from settings. */}
        <Card>
          <CardHeader title={t('projects.stepTeam')} />

          <div className="space-y-3 p-card">
            <p className="text-sm text-content-tertiary">{t('projects.inviteHint')}</p>

            {[0, 1, 2].map((row) => (
              <div key={row} className="flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{t('projects.inviteEmail')}</span>
                  <input
                    type="email"
                    name="inviteEmail"
                    maxLength={255}
                    autoComplete="off"
                    placeholder={row === 0 ? 'client@company.com' : 'name@company.com'}
                    className="field text-md"
                  />
                </label>

                <label className="sm:w-48">
                  <span className="sr-only">{t('projects.inviteRole')}</span>
                  {/* Row one defaults to CLIENT: the first person a new project
                      needs is the one it is being built for. */}
                  <select
                    name="inviteRole"
                    defaultValue={row === 0 ? 'CLIENT' : 'DEVELOPER'}
                    className="field text-md"
                  >
                    <option value="DEVELOPER">{t('roles.DEVELOPER')}</option>
                    <option value="CLIENT">{t('roles.CLIENT')}</option>
                    <option value="PROJECT_MANAGER">{t('roles.PROJECT_MANAGER')}</option>
                  </select>
                </label>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Link to={`/w/${slug}/projects`} className="rounded-md border border-stroke-subtle px-4 py-2.5 text-md font-medium text-content-secondary no-underline hover:bg-surface-hover">
            {t('common.cancel')}
          </Link>
          <button type="submit" disabled={navigation.state === 'submitting'} className="btn-primary">
            {t('projects.create')}
          </button>
        </div>
      </Form>
    </div>
  );
}
