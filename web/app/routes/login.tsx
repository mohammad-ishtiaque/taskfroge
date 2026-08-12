import { Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/login';
import { ApiError, callApi } from '~/lib/api.server';
import { commitSession, getSession, redirectIfAuthenticated, setTokens } from '~/lib/session.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { Field } from '~/components/ui/Field';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Sign in · TaskForge' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await redirectIfAuthenticated(request);
  return null;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: { id: string; email: string; name: string; locale: string };
  organization: { id: string; name: string; role: 'CLIENT' | 'PROJECT_MANAGER' | 'DEVELOPER' };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectTo = String(formData.get('redirectTo') ?? '/');

  // Client-side check so an empty submit does not cost a round trip.
  if (!email || !password) {
    return { errorCode: 'VALIDATION_FAILED' as const };
  }

  try {
    const result = await callApi<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
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

    // Only same-origin paths. An open redirect here would let a phishing link
    // bounce a freshly authenticated user to an attacker's page.
    const safeRedirect = redirectTo.startsWith('/') && !redirectTo.startsWith('//')
      ? redirectTo
      : '/';

    return redirect(safeRedirect, {
      headers: { 'Set-Cookie': await commitSession(session) },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { errorCode: error.code, requestId: error.requestId };
    }
    throw error;
  }
}

export default function Login({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const submitting = navigation.formAction === '/login';
  const errorCode = actionData?.errorCode;

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
            <h1 className="text-2xl">{t('auth.signInTitle')}</h1>
            <p className="mt-2 text-md text-content-secondary">{t('auth.signInSubtitle')}</p>
          </div>

          <div className="rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-sm">
            <Form method="post" className="flex flex-col gap-5">
              <input
                type="hidden"
                name="redirectTo"
                value={searchParams.get('redirectTo') ?? '/'}
              />

              {errorCode && (
                <Alert tone="danger">
                  {/* The code is translated; the API's own wording never
                      reaches the screen. */}
                  {t(`errors.${errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
                </Alert>
              )}

              <Field
                label={t('common.email')}
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={255}
                autoFocus
                placeholder="you@agency.com"
              />

              <Field
                label={t('common.password')}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                action={
                  <Link to="/forgot-password" className="text-xs font-medium">
                    {t('auth.forgotPassword')}
                  </Link>
                }
              />

              <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
                {submitting ? t('auth.signingIn') : t('common.signIn')}
              </Button>

              <p className="text-center text-sm text-content-secondary">
                {t('auth.noAccount')}{' '}
                <Link to="/register" className="font-medium">
                  {t('auth.createWorkspace')}
                </Link>
              </p>
            </Form>
          </div>
        </div>
      </main>
    </div>
  );
}
