import { Form, redirect, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.projects.$key.settings';
import { Card, CardHeader } from '~/components/ui/Card';
import { ConfirmButton } from '~/components/ui/ConfirmButton';
import { Icon } from '~/components/ui/Icon';
import {
  archiveProject,
  getProject,
  inviteToProject,
  listMembers,
  restoreProject,
  revokeInvitation,
  setProjectVisibility,
  updateProject,
} from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { ApiError, toErrorCode } from '~/lib/api.server';
import type { Person, VisibilityPreset } from '~/data/types';

/** The six toggles from docs/04 §3, and only those six. */
const TOGGLES = [
  'showBoard',
  'showAssignees',
  'showDueDates',
  'showTimeTracking',
  'showBlockedReasons',
  'showAttachments',
] as const;

/** Presets are stored expanded, so switching preset never silently rewrites
    a custom choice the PM made on purpose. */
const PRESETS: Record<Exclude<VisibilityPreset, 'CUSTOM'>, Record<string, boolean>> = {
  OPEN: {
    showBoard: true, showAssignees: true, showDueDates: true,
    showTimeTracking: false, showBlockedReasons: true, showAttachments: true,
  },
  SUMMARY: {
    showBoard: false, showAssignees: false, showDueDates: true,
    showTimeTracking: false, showBlockedReasons: false, showAttachments: true,
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);

  // Only a PM configures a project. A developer reaching this URL gets 404,
  // not a form that refuses on submit.
  if (user.role !== 'PROJECT_MANAGER') throw new Response('Not Found', { status: 404 });

  const [project, members] = await Promise.all([
    getProject(request, params.key!),
    listMembers(request, params.key!),
  ]);

  return { slug: params.slug!, project, members };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get('intent'));

  try {
    if (intent === 'visibility') {
      const preset = String(form.get('preset')) as VisibilityPreset;
      const base = preset === 'CUSTOM'
        ? Object.fromEntries(TOGGLES.map((k) => [k, form.get(k) === 'on']))
        : PRESETS[preset];

      await setProjectVisibility(request, params.key!, { preset, ...base } as never);
      return { saved: 'visibility' as const };
    }

    if (intent === 'details') {
      const start = String(form.get('startDate') ?? '');
      const end = String(form.get('endDate') ?? '');
      if (start && end && new Date(end) < new Date(start)) {
        return { errorCode: 'END_BEFORE_START' };
      }

      await updateProject(request, params.key!, {
        name: String(form.get('name') ?? '').trim(),
        description: String(form.get('description') ?? '').trim(),
        status: String(form.get('status')) as never,
        priority: String(form.get('priority')) as never,
        startDate: start || null,
        endDate: end || null,
      });
      return { saved: 'details' as const };
    }

    if (intent === 'invite') {
      const result = await inviteToProject(request, params.key!, {
        email: String(form.get('email') ?? '').trim(),
        role: String(form.get('role') ?? 'DEVELOPER') as Person['role'],
      });

      // Two different sentences, because they describe two different things
      // having happened. "Invitation sent" for someone who was added straight
      // to the project leaves the PM waiting for an acceptance that will never
      // come, and eventually re-sending.
      return result.outcome === 'added'
        ? { added: result.name ?? result.email }
        : { invited: result.email };
    }

    if (intent === 'revoke') {
      await revokeInvitation(request, String(form.get('invitationId') ?? ''));
      return { saved: 'revoked' as const };
    }

    if (intent === 'archive') {
      await archiveProject(request, params.key!);
      // Back to the list, because the thing you were looking at is no longer
      // somewhere you can work. Staying on a settings page for an archived
      // project is a screen with nothing useful left on it.
      return redirect(`/w/${params.slug}/projects`);
    }

    if (intent === 'restore') {
      await restoreProject(request, params.key!);
      return { saved: 'restored' as const };
    }
  } catch (error) {
    // Field-level issues go back to the input that caused them. A bad email
    // address highlighted under the box beats a banner at the top of a page
    // with three forms on it.
    if (error instanceof ApiError) {
      return { errorCode: error.code, fieldIssues: error.fieldIssues };
    }
    return { errorCode: toErrorCode(error) };
  }

  return { saved: null };
}

export default function ProjectSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const { project, members, slug } = loaderData;
  const v = project.visibility;
  const invitations = project.invitations ?? [];
  const busy = navigation.state === 'submitting';
  // The reader's language, not the server's. An expiry date is one of the few
  // things on this page that reads wrong in the wrong locale rather than just
  // reading foreign.
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  const emailIssue =
    actionData && 'fieldIssues' in actionData ? actionData.fieldIssues?.email?.[0] : undefined;

  const archived = project.archivedAt !== null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {archived && (
        <p className="flex items-start gap-2 rounded-md border border-stroke-subtle bg-surface-sunken px-4 py-3 text-md text-content-secondary lg:col-span-2">
          <Icon name="archive" size={16} className="mt-0.5 shrink-0" />
          {t('projects.archivedBanner')}
        </p>
      )}
      {actionData && 'errorCode' in actionData && actionData.errorCode && (
        <p role="alert" className="rounded-md border border-danger-500 bg-danger-50 px-4 py-3 text-md text-danger-700 lg:col-span-2">
          {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
        </p>
      )}
      {actionData && 'invited' in actionData && actionData.invited && (
        <p className="rounded-md border border-success-500 bg-success-50 px-4 py-3 text-md text-success-700 lg:col-span-2">
          {t('projects.inviteSent', { email: actionData.invited })}
        </p>
      )}
      {actionData && 'added' in actionData && actionData.added && (
        <p className="rounded-md border border-success-500 bg-success-50 px-4 py-3 text-md text-success-700 lg:col-span-2">
          {t('projects.added', { name: actionData.added })}
        </p>
      )}
      {actionData && 'saved' in actionData && actionData.saved && (
        <p className="rounded-md border border-success-500 bg-success-50 px-4 py-3 text-md text-success-700 lg:col-span-2">
          {t('settings.saved')}
        </p>
      )}

      <Card>
        <CardHeader title={t('settings.projectDetails')} />
        <Form method="post" className="space-y-4 p-card">
          <input type="hidden" name="intent" value="details" />

          <label className="block">
            <span className="text-md font-medium">{t('settings.projectName')}</span>
            <input name="name" defaultValue={project.name} maxLength={120} className="mt-1.5 field text-md " />
          </label>

          <label className="block">
            <span className="text-md font-medium">{t('settings.description')}</span>
            <textarea name="description" rows={3} defaultValue={project.description} className="field mt-1.5" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-md font-medium">{t('tasks.status')}</span>
              <select name="status" defaultValue={project.status} className="field mt-1.5">
                {(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const).map((s) => (
                  <option key={s} value={s}>{t(`projectStatus.${s}`)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-md font-medium">{t('tasks.priority')}</span>
              <select name="priority" defaultValue={project.priority} className="field mt-1.5">
                {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => (
                  <option key={p} value={p}>{t(`priority.${p}`)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-md font-medium">{t('settings.startDate')}</span>
              <input type="date" name="startDate" defaultValue={project.startDate?.slice(0, 10)} className="mt-1.5 field text-md " />
            </label>
            <label className="block">
              <span className="text-md font-medium">{t('settings.endDate')}</span>
              <input type="date" name="endDate" defaultValue={project.endDate?.slice(0, 10)} className="mt-1.5 field text-md " />
            </label>
          </div>

          <button type="submit" className="btn-primary">
            <Icon name="save" size={15} />
            {t('common.saveChanges')}
          </button>
        </Form>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title={t('settings.teamMembers', { count: members.length })} />
          <ul className="divide-y divide-[var(--border-subtle)]">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-card py-3">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ background: member.avatarColor }}
                >
                  {member.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-md font-medium text-content-primary">{member.name}</span>
                  <span className="block truncate text-sm text-content-tertiary">{member.email}</span>
                </span>
                <span className="rounded-md bg-surface-sunken px-2 py-1 text-xs font-semibold text-content-secondary">
                  {t(`roles.${member.role}`)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/* ── Inviting ─────────────────────────────────────────────────────
            This card is why the Team page's "Invite" button pointed here. It
            did not exist, so the button was a dead end — the only working
            invite form was on an older screen the workspace UI never links to.

            Membership is per project, which is why inviting lives on a project
            rather than on the workspace: an invitation has to say *to what*. */}
        <Card>
          <CardHeader title={t('projects.invite')} />

          <Form method="post" replace className="space-y-4 p-card">
            <input type="hidden" name="intent" value="invite" />

            <p className="text-sm text-content-tertiary">{t('projects.inviteHint')}</p>

            <label className="block">
              <span className="text-md font-medium">{t('projects.inviteEmail')}</span>
              <input
                type="email"
                name="email"
                required
                maxLength={255}
                autoComplete="off"
                placeholder="name@company.com"
                aria-invalid={emailIssue ? true : undefined}
                aria-describedby={emailIssue ? 'invite-email-error' : undefined}
                className={`mt-1.5 field text-md ${emailIssue ? 'border-danger-500' : ''}`}
              />
              {emailIssue && (
                <span id="invite-email-error" role="alert" className="mt-1 block text-sm text-danger-700">
                  {emailIssue}
                </span>
              )}
            </label>

            <label className="block">
              <span className="text-md font-medium">{t('projects.inviteRole')}</span>
              {/* A client is invited exactly like a developer. The role decides
                  what they see once they are in, and that is the only thing it
                  decides here. */}
              <select name="role" defaultValue="DEVELOPER" className="field mt-1.5 text-md">
                <option value="DEVELOPER">{t('roles.DEVELOPER')}</option>
                <option value="CLIENT">{t('roles.CLIENT')}</option>
                <option value="PROJECT_MANAGER">{t('roles.PROJECT_MANAGER')}</option>
              </select>
            </label>

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? t('projects.sending') : t('projects.sendInvite')}
            </button>
          </Form>

          {invitations.length > 0 && (
            <div className="border-t border-stroke-subtle p-card">
              <p className="label-caps">{t('projects.pending')}</p>

              <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md text-content-primary">
                        {invitation.email}
                      </span>
                      <span className="block text-sm text-content-tertiary">
                        {t(`roles.${invitation.role}`)} ·{' '}
                        {t('projects.expires', { date: dates.format(new Date(invitation.expiresAt)) })}
                      </span>
                    </span>

                    <Form method="post" replace>
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <ConfirmButton
                        variant="danger"
                        title={t('projects.revokeTitle')}
                        message={t('projects.revokeBody', { email: invitation.email })}
                      >
                        {t('projects.revoke')}
                      </ConfirmButton>
                    </Form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* ── What the client sees ─────────────────────────────────────── */}
        <Card>
          <CardHeader title={t('visibility.title')} />

          <Form method="post" className="space-y-5 p-card">
            <input type="hidden" name="intent" value="visibility" />

            <fieldset>
              <legend className="text-md font-medium text-content-primary">{t('visibility.preset')}</legend>
              <div className="mt-2 space-y-2">
                {(['OPEN', 'SUMMARY', 'CUSTOM'] as const).map((preset) => (
                  <label key={preset} className="flex cursor-pointer items-start gap-3 rounded-md border border-stroke-subtle p-3 hover:bg-surface-hover">
                    <input type="radio" name="preset" value={preset} defaultChecked={v.preset === preset} className="mt-1" />
                    <span>
                      <span className="block text-md font-medium text-content-primary">{t(`visibility.${preset}`)}</span>
                      <span className="block text-sm text-content-tertiary">{t(`visibility.${preset}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-md font-medium text-content-primary">{t('visibility.toggles')}</legend>
              <p className="mt-0.5 text-sm text-content-tertiary">{t('visibility.togglesHint')}</p>

              <div className="mt-2 space-y-1">
                {TOGGLES.map((key) => (
                  <label key={key} className="flex items-start gap-3 rounded-md px-1 py-2">
                    <input type="checkbox" name={key} defaultChecked={v[key]} className="mt-1" />
                    <span>
                      <span className="block text-md text-content-primary">{t(`visibility.${key}`)}</span>
                      {key === 'showTimeTracking' && (
                        <span className="block text-sm text-content-tertiary">{t('visibility.showTimeTrackingHint')}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Stated, never a toggle. A switch implies someone might turn it
                off, and the day someone does is the day a developer's honest
                note about a bad estimate reaches the client. */}
            <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-3 py-2.5 text-sm text-content-secondary">
              <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
              {t('visibility.internalRule')}
            </p>

            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={navigation.state === 'submitting'} className="btn-primary">
                <Icon name="save" size={15} />
                {t('common.saveChanges')}
              </button>

              <a
                href={`/w/${slug}/projects/${project.key}/tasks`}
                className="inline-flex items-center gap-2 rounded-md border border-stroke-subtle px-4 py-2.5 text-md font-medium text-content-secondary no-underline hover:bg-surface-hover"
              >
                <Icon name="eye" size={15} />
                {t('visibility.previewAsClient')}
              </a>
            </div>
          </Form>
        </Card>

        {/* ── Archiving ────────────────────────────────────────────────────
            Last on the page on purpose. It is the one control here that
            changes whether the project exists as far as everyone else is
            concerned, and it should not sit next to a name field.

            The endpoints have existed since M1 and nothing ever called them,
            so a finished project stayed in everyone's sidebar forever. */}
        <Card>
          <CardHeader title={t('projects.dangerZone')} />

          <div className="flex flex-wrap items-center justify-between gap-3 p-card">
            <p className="min-w-0 flex-1 text-sm text-content-tertiary">
              {archived ? t('projects.restoreBody') : t('projects.archiveBody')}
            </p>

            <Form method="post" replace>
              <input type="hidden" name="intent" value={archived ? 'restore' : 'archive'} />
              <ConfirmButton
                variant={archived ? 'secondary' : 'danger'}
                title={archived ? t('projects.restoreTitle') : t('projects.archiveTitle')}
                message={archived ? t('projects.restoreBody') : t('projects.archiveBody')}
              >
                {archived ? t('projects.restore') : t('projects.archive')}
              </ConfirmButton>
            </Form>
          </div>
        </Card>
      </div>
    </div>
  );
}
