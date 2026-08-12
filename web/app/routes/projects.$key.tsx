import { Form, Link, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/projects.$key';
import { ApiError, callApi } from '~/lib/api.server';
import { getProject, listAssignable, type AssignableUser } from '~/lib/projects.server';
import { requireUser } from '~/lib/session.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { Field } from '~/components/ui/Field';
import { Avatar } from '~/components/ui/Avatar';
import { ConfirmButton } from '~/components/ui/ConfirmButton';
import { AppHeader } from '~/components/layout/AppHeader';

export function meta({ data }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${data?.project.name ?? 'Project'} · TaskForge` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // A project the caller is not on returns 404 from the API, which surfaces
  // here as the route error boundary. That is the intended outcome — a 403
  // would confirm the project exists.
  const project = await getProject(request, params.key!);

  // Only a project manager can staff a project, and only they can call this
  // endpoint — asking as anyone else would be a guaranteed 403.
  const assignable: AssignableUser[] =
    user.role === 'PROJECT_MANAGER'
      ? await listAssignable(request, params.key!).catch(() => [])
      : [];

  return { user, project, assignable };
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? '');
  const key = params.key!;

  try {
    if (intent === 'invite') {
      const email = String(formData.get('email') ?? '').trim();
      // Someone who is already in the workspace is added outright — there is no
      // link for them to click, so reporting "invitation sent" would be a lie
      // that leaves the PM waiting for an acceptance that never comes.
      const result = await callApi<{ outcome: 'added' | 'invited'; name?: string }>(
        `/projects/${key}/invitations`,
        {
          method: 'POST',
          request,
          body: { email, role: String(formData.get('role') ?? 'DEVELOPER') },
        },
      );
      return result.outcome === 'added'
        ? { added: result.name ?? email }
        : { invited: email };
    }

    if (intent === 'revoke') {
      await callApi(`/projects/invitations/${String(formData.get('invitationId'))}`, {
        method: 'DELETE',
        request,
      });
      return { revoked: true as const };
    }

    if (intent === 'addMember') {
      await callApi(`/projects/${key}/members`, {
        method: 'POST',
        request,
        body: { userId: String(formData.get('userId')) },
      });
      return { added: String(formData.get('userName') ?? '') };
    }

    if (intent === 'removeMember') {
      await callApi(`/projects/${key}/members/${String(formData.get('userId'))}`, {
        method: 'DELETE',
        request,
      });
      return { removed: true as const };
    }

    return null;
  } catch (error) {
    if (error instanceof ApiError) {
      return { errorCode: error.code, fieldIssues: error.fieldIssues };
    }
    throw error;
  }
}

export default function ProjectDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const { user, project, assignable } = loaderData;

  const isManager = user.role === 'PROJECT_MANAGER';
  const busy = navigation.state === 'submitting';
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <div className="min-h-dvh bg-surface-canvas">
      <AppHeader user={user} />

      <main className="mx-auto max-w-3xl px-page-x py-page-y">
        <Link to="/projects" className="text-sm">
          ← {t('projects.title')}
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="rounded-sm bg-surface-sunken px-2 py-1 font-mono text-sm font-semibold text-content-secondary">
            {project.key}
          </code>
          <h1 className="text-3xl">{project.name}</h1>
        </div>

        {project.description && (
          <p className="mt-2 text-md text-content-secondary">{project.description}</p>
        )}

        {actionData && 'errorCode' in actionData && actionData.errorCode && (
          <Alert tone="danger" className="mt-4">
            {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
          </Alert>
        )}
        {actionData && 'invited' in actionData && (
          <Alert tone="success" className="mt-4">
            {t('projects.inviteSent', { email: actionData.invited })}
          </Alert>
        )}
        {actionData && 'added' in actionData && (
          <Alert tone="success" className="mt-4">
            {t('projects.added', { name: actionData.added })}
          </Alert>
        )}

        {/* ── Team ── */}
        <section className="mt-8 rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-xs">
          <h2 className="text-xl">{t('projects.team')}</h2>

          <ul className="mt-4 divide-y divide-stroke-subtle">
            {project.members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-3">
                <Avatar name={member.user.name} src={member.user.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-md font-medium">{member.user.name}</p>
                  <p className="truncate text-sm text-content-tertiary">{member.user.email}</p>
                </div>
                {isManager && member.user.id !== user.id && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="removeMember" />
                    <input type="hidden" name="userId" value={member.user.id} />
                    <ConfirmButton
                      title={t('projects.removeTitle', { name: member.user.name })}
                      message={t('projects.removeBody')}
                    >
                      {t('projects.remove')}
                    </ConfirmButton>
                  </Form>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isManager && (
          <>
            {/* ── Add someone who already has an account ── */}
            <section className="mt-6 rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-xs">
              <h2 className="text-xl">{t('projects.addExisting')}</h2>
              <p className="mt-1 text-md text-content-secondary">
                {t('projects.addExistingHint')}
              </p>

              {assignable.length === 0 ? (
                <p className="mt-4 text-md text-content-tertiary">
                  {t('projects.noneAssignable')}
                </p>
              ) : (
                <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="intent" value="addMember" />
                  <div className="flex min-w-[240px] flex-1 flex-col gap-2">
                    <label htmlFor="add-person" className="text-sm font-medium">
                      {t('projects.choosePerson')}
                    </label>
                    <select
                      id="add-person"
                      name="userId"
                      required
                      className="field h-9"
                      onChange={(event) => {
                        // Carry the name so the confirmation can say who was
                        // added, without a second lookup after the redirect.
                        const form = event.currentTarget.form;
                        const hidden = form?.elements.namedItem('userName');
                        if (hidden instanceof HTMLInputElement) {
                          hidden.value =
                            event.currentTarget.selectedOptions[0]?.dataset.name ?? '';
                        }
                      }}
                    >
                      <option value="">—</option>
                      {assignable.map((person) => (
                        <option key={person.id} value={person.id} data-name={person.name}>
                          {person.name} · {t(`roles.${person.memberships[0]?.role ?? 'DEVELOPER'}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input type="hidden" name="userName" value="" />
                  <Button type="submit" variant="primary" loading={busy}>
                    {t('projects.add')}
                  </Button>
                </Form>
              )}
            </section>

            {/* ── Invite ── */}
            <section className="mt-6 rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-xs">
              <h2 className="text-xl">{t('projects.invite')}</h2>

              <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="intent" value="invite" />
                <p className="text-sm text-muted">{t('projects.inviteHint')}</p>
                <div className="min-w-[220px] flex-1">
                  <Field
                    label={t('projects.inviteEmail')}
                    name="email"
                    type="email"
                    required
                    maxLength={255}
                    error={
                      actionData && 'fieldIssues' in actionData
                        ? actionData.fieldIssues?.email?.[0]
                        : undefined
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">{t('projects.inviteRole')}</label>
                  <select
                    name="role"
                    defaultValue="DEVELOPER"
                    className="field h-9"
                  >
                    <option value="DEVELOPER">{t('roles.DEVELOPER')}</option>
                    <option value="CLIENT">{t('roles.CLIENT')}</option>
                    <option value="PROJECT_MANAGER">{t('roles.PROJECT_MANAGER')}</option>
                  </select>
                </div>
                <Button type="submit" variant="primary" loading={busy}>
                  {busy ? t('projects.sending') : t('projects.sendInvite')}
                </Button>
              </Form>

              {project.invitations.length > 0 && (
                <div className="mt-6">
                  <p className="label-caps">{t('projects.pending')}</p>
                  <ul className="mt-2 divide-y divide-stroke-subtle">
                    {project.invitations.map((invitation) => (
                      <li key={invitation.id} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-md">{invitation.email}</p>
                          <p className="text-xs text-content-tertiary">
                            {t(`roles.${invitation.role}`)} ·{' '}
                            {t('projects.expires', {
                              date: dateFormat.format(new Date(invitation.expiresAt)),
                            })}
                          </p>
                        </div>
                        <Form method="post">
                          <input type="hidden" name="intent" value="revoke" />
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <ConfirmButton
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
            </section>

            {/* ── What the client sees ── */}
            <section className="mt-6 rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-xs">
              <h2 className="text-xl">{t('projects.stepVisibility')}</h2>

              <p className="mt-3 text-md">
                <strong>
                  {t(
                    `projects.preset${(project.visibility?.preset ?? 'OPEN')
                      .charAt(0)}${(project.visibility?.preset ?? 'OPEN')
                      .slice(1)
                      .toLowerCase()}`,
                  )}
                </strong>
              </p>

              <ul className="mt-3 grid gap-1 text-sm text-content-secondary sm:grid-cols-2">
                {(
                  [
                    'showBoard',
                    'showAssignees',
                    'showDueDates',
                    'showTimeTracking',
                    'showBlockedReasons',
                    'showAttachments',
                  ] as const
                ).map((toggle) => (
                  <li key={toggle}>
                    {project.visibility?.[toggle] ? '✓' : '✗'} {t(`projects.${toggle}`)}
                  </li>
                ))}
              </ul>

              <p className="mt-4 rounded-md bg-surface-sunken px-3 py-2 text-sm text-content-secondary">
                {t('projects.internalNote')}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
