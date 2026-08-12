import { Form, Link, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/account';
import { ApiError, callApi } from '~/lib/api.server';
import { requireUser } from '~/lib/session.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { ConfirmButton } from '~/components/ui/ConfirmButton';
import { Field } from '~/components/ui/Field';
import { RoleBadge } from '~/components/ui/RoleBadge';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Account · TaskForge' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return { user: await requireUser(request) };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? '');

  if (intent === 'signOutEverywhere') {
    const result = await callApi<{ revokedSessions: number }>('/auth/logout-all', {
      method: 'POST',
      request,
    });
    return { signedOut: result.revokedSessions };
  }

  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  // A confirmation field is a guard against typos, not a server rule — the API
  // has no concept of it, so it is checked here.
  if (newPassword !== confirm) return { mismatch: true as const };

  try {
    await callApi('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      request,
    });
    return { passwordChanged: true as const };
  } catch (error) {
    if (error instanceof ApiError) {
      return { errorCode: error.code, fieldIssues: error.fieldIssues };
    }
    throw error;
  }
}

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { user } = loaderData;

  const busy = navigation.formAction === '/account';
  const issues = actionData && 'fieldIssues' in actionData ? actionData.fieldIssues : null;

  return (
    <div className="min-h-dvh bg-surface-canvas">
      <header className="border-b border-stroke-subtle bg-surface-raised">
        <div className="mx-auto flex h-topbar max-w-content items-center gap-3 px-page-x">
          <Link to="/" className="text-md font-semibold no-underline">
            {user.orgName}
          </Link>
          <div className="ms-auto flex items-center gap-3">
            <LocaleSwitcher />
            <RoleBadge role={user.role} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-page-x py-page-y">
        <Link to="/" className="text-sm">
          ← {t('account.backToHome')}
        </Link>

        <h1 className="mt-4 text-3xl">{t('account.title')}</h1>
        <p className="mt-2 text-md text-content-secondary">{t('account.subtitle')}</p>

        <p className="mt-4 text-md text-content-secondary">
          {user.name} · {user.email}
        </p>

        {/* Change password */}
        <section className="mt-8 rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-xs">
          <h2 className="text-xl">{t('account.changePassword')}</h2>

          <Form method="post" className="mt-5 flex flex-col gap-5">
            <input type="hidden" name="intent" value="changePassword" />

            {actionData && 'passwordChanged' in actionData && (
              <Alert tone="success">{t('account.passwordUpdated')}</Alert>
            )}
            {actionData && 'errorCode' in actionData && actionData.errorCode && (
              <Alert tone="danger">
                {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
              </Alert>
            )}

            <Field
              label={t('account.currentPassword')}
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              error={issues?.currentPassword?.[0]}
            />

            <Field
              label={t('auth.newPassword')}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              hint={t('auth.passwordHint')}
              error={issues?.newPassword?.[0]}
            />

            <Field
              label={t('auth.confirmPassword')}
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              error={
                actionData && 'mismatch' in actionData
                  ? t('auth.passwordsDoNotMatch')
                  : undefined
              }
            />

            <Button type="submit" variant="primary" loading={busy} className="self-start">
              {busy ? t('account.updating') : t('account.updatePassword')}
            </Button>
          </Form>
        </section>

        {/* Sessions */}
        <section className="mt-6 rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-xs">
          <h2 className="text-xl">{t('account.sessions')}</h2>
          <p className="mt-2 text-md text-content-secondary">{t('account.sessionsHint')}</p>

          {actionData && 'signedOut' in actionData && (
            <Alert tone="success" className="mt-4">
              {t('account.signedOutCount', { count: actionData.signedOut })}
            </Alert>
          )}

          <Form method="post" className="mt-5">
            <input type="hidden" name="intent" value="signOutEverywhere" />
            {/* Secondary, not danger: this is a sensible precaution, not a
                destructive act, and colouring it red discourages using it. It
                still confirms, because it ends other people's sessions. */}
            <ConfirmButton
              variant="secondary"
              size="md"
              title={t('account.signOutEverywhereTitle')}
              message={t('account.signOutEverywhereBody')}
            >
              {t('account.signOutEverywhere')}
            </ConfirmButton>
          </Form>
        </section>
      </main>
    </div>
  );
}
