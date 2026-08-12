import { Form, Link, redirect, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/register';
import { ApiError, callApi } from '~/lib/api.server';
import { commitSession, getSession, redirectIfAuthenticated, setTokens } from '~/lib/session.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { Field } from '~/components/ui/Field';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Create your workspace · TaskForge' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await redirectIfAuthenticated(request);
  return null;
}

interface RegisterResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: { id: string; email: string; name: string; locale: string };
  organization: { id: string; name: string; role: 'CLIENT' | 'PROJECT_MANAGER' | 'DEVELOPER' };
}

/**
 * Creating a workspace — not joining one.
 *
 * Whoever does this becomes the project manager. Developers and clients never
 * arrive here; they arrive by invitation, which is why this page talks about a
 * company rather than about "signing up".
 */
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const name = String(formData.get('name') ?? '').trim();
  const organizationName = String(formData.get('organizationName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  try {
    const result = await callApi<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: { name, organizationName, email, password },
    });

    const session = await getSession(request);
    setTokens(session, result);
    session.set('locale', result.user.locale);
    session.set('user', {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.organization.role,
      orgId: result.organization.id,
      orgName: result.organization.name,
      locale: result.user.locale,
    });

    // Straight in, rather than bouncing to a login form they just proved they
    // can pass. Asking someone to type the password they set ten seconds ago
    // is a pointless step.
    return redirect('/', { headers: { 'Set-Cookie': await commitSession(session) } });
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        errorCode: error.code,
        // Field-level messages so "email already in use" lands on the email
        // input rather than in a banner the user has to map back themselves.
        fieldIssues: error.fieldIssues,
        conflictField: error.code === 'ALREADY_EXISTS' ? 'email' : null,
      };
    }
    throw error;
  }
}

export default function Register({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const submitting = navigation.formAction === '/register';

  const issues = actionData?.fieldIssues;
  const emailError =
    issues?.email?.[0] ??
    (actionData?.conflictField === 'email'
      ? t('errors.ALREADY_EXISTS')
      : undefined);

  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <header className="flex h-topbar items-center justify-end px-page-x">
        <LocaleSwitcher />
      </header>

      <main className="flex flex-1 items-start justify-center px-page-x pb-16 pt-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <span
              aria-hidden
              className="mx-auto mb-4 flex size-11 items-center justify-center
                         rounded-lg bg-brand-600 text-xl font-bold text-white"
            >
              T
            </span>
            <h1 className="text-2xl">{t('auth.registerTitle')}</h1>
            <p className="mt-2 text-md text-content-secondary">
              {t('auth.registerSubtitle')}
            </p>
          </div>

          <div className="rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-sm">
            <Form method="post" className="flex flex-col gap-5">
              {actionData?.errorCode && actionData.errorCode !== 'ALREADY_EXISTS' && (
                <Alert tone="danger">
                  {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
                </Alert>
              )}

              <Field
                label={t('auth.organizationName')}
                name="organizationName"
                required
                autoFocus
                maxLength={120}
                placeholder="Moob02 Software"
                error={issues?.organizationName?.[0]}
              />

              <Field
                label={t('auth.yourName')}
                name="name"
                autoComplete="name"
                required
                maxLength={120}
                error={issues?.name?.[0]}
              />

              <Field
                label={t('common.email')}
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={255}
                error={emailError}
              />

              <Field
                label={t('common.password')}
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
                hint={t('auth.passwordHint')}
                error={issues?.password?.[0]}
              />

              <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
                {submitting ? t('auth.creating') : t('auth.createWorkspace')}
              </Button>

              <p className="text-center text-sm text-content-secondary">
                {t('auth.haveAccount')}{' '}
                <Link to="/login" className="font-medium">
                  {t('common.signIn')}
                </Link>
              </p>
            </Form>
          </div>
        </div>
      </main>
    </div>
  );
}
