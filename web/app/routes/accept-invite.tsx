import { Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/accept-invite';
import { ApiError, callApi } from '~/lib/api.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { Field } from '~/components/ui/Field';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Join a project · TaskForge' }];
}

interface Preview {
  email: string;
  role: string;
  projectName: string;
  organizationName: string;
  invitedByName: string;
  hasAccount: boolean;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return { preview: null, token: null };

  try {
    return { preview: await callApi<Preview>('/invitations/preview', { query: { token } }), token };
  } catch {
    // Expired, revoked, used, or never real — all the same message, so a
    // guessed token learns nothing from the response.
    return { preview: null, token };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();

  try {
    await callApi('/invitations/accept', {
      method: 'POST',
      body: {
        token: String(formData.get('token') ?? ''),
        name: String(formData.get('name') ?? '') || undefined,
        password: String(formData.get('password') ?? '') || undefined,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { errorCode: error.code, fieldIssues: error.fieldIssues };
    }
    throw error;
  }

  // Deliberately not signed in automatically. Accepting proves you can open the
  // email, not that you know the password — so an intercepted link cannot be
  // turned into a session.
  return redirect('/login?joined=1');
}

export default function AcceptInvite({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const { preview } = loaderData;
  const token = loaderData.token ?? searchParams.get('token') ?? '';
  const busy = navigation.formAction === '/accept-invite';
  const issues = actionData?.fieldIssues;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <header className="flex h-topbar items-center justify-end px-page-x">
        <LocaleSwitcher />
      </header>

      <main className="flex flex-1 items-start justify-center px-page-x pb-16 pt-8">
        <div className="w-full max-w-sm">
          {!preview ? (
            <div className="rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-sm">
              <Alert tone="danger">{t('invite.invalid')}</Alert>
              <Link to="/login" className="mt-5 block text-center text-md font-medium">
                {t('auth.backToSignIn')}
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="text-2xl">{t('invite.title')}</h1>
                <p className="mt-2 text-md text-content-secondary">
                  {t('invite.subtitle', {
                    inviter: preview.invitedByName,
                    project: preview.projectName,
                    org: preview.organizationName,
                  })}
                </p>
              </div>

              <div className="rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-sm">
                <Form method="post" className="flex flex-col gap-5">
                  <input type="hidden" name="token" value={token} />

                  {actionData?.errorCode && (
                    <Alert tone="danger">
                      {t(`errors.${actionData.errorCode}`, {
                        defaultValue: t('errors.UNKNOWN'),
                      })}
                    </Alert>
                  )}

                  <p className="text-md text-content-secondary">
                    {preview.hasAccount ? t('invite.signInToJoin') : t('invite.createAccount')}
                  </p>

                  <Field label={t('common.email')} value={preview.email} disabled readOnly />

                  {!preview.hasAccount && (
                    <>
                      <Field
                        label={t('invite.yourName')}
                        name="name"
                        required
                        autoFocus
                        maxLength={120}
                        error={issues?.name?.[0]}
                      />
                      <Field
                        label={t('common.password')}
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        hint={t('auth.passwordHint')}
                        error={issues?.password?.[0]}
                      />
                    </>
                  )}

                  <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
                    {busy ? t('invite.joining') : t('invite.join')}
                  </Button>
                </Form>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
