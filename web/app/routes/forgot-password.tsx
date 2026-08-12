import { Form, Link, data, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/forgot-password';
import { ApiError, callApi } from '~/lib/api.server';
import { resetChallenge } from '~/lib/challenge.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { Field } from '~/components/ui/Field';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Reset password · TaskForge' }];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim();

  if (!email) return { errorCode: 'VALIDATION_FAILED' as const };

  let challenge: string | undefined;

  try {
    const result = await callApi<{ message: string; challenge: string }>(
      '/auth/forgot-password',
      { method: 'POST', body: { email } },
    );
    challenge = result.challenge;
  } catch (error) {
    // Rate limiting is the one failure worth surfacing — it tells the user to
    // wait rather than keep clicking.
    if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
      return { errorCode: error.code };
    }
    // Everything else is swallowed on purpose. Reporting "no such account"
    // would turn this form into an account-enumeration tool.
  }

  // The second secret. From here it lives in an httpOnly cookie on *this*
  // browser and nowhere else — not in the email, not in the URL, not in the
  // page. Completing the reset needs both it and the emailed token, so a
  // forwarded link on its own is no longer enough to take the account.
  //
  // Written even when the address is unknown, because the API returns one
  // either way: a cookie that appears only for real accounts would be exactly
  // the enumeration signal the matching response text is there to avoid.
  return data(
    { sent: true as const },
    challenge
      ? { headers: { 'Set-Cookie': await resetChallenge.serialize(challenge) } }
      : undefined,
  );
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const submitting = navigation.formAction === '/forgot-password';

  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <header className="flex h-topbar items-center justify-end px-page-x">
        <LocaleSwitcher />
      </header>

      <main className="flex flex-1 items-start justify-center px-page-x pb-16 pt-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl">{t('auth.forgotTitle')}</h1>
            <p className="mt-2 text-md text-content-secondary">{t('auth.forgotSubtitle')}</p>
          </div>

          <div className="rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-sm">
            {actionData && 'sent' in actionData ? (
              <div className="flex flex-col gap-5">
                <Alert tone="success">{t('auth.resetLinkSent')}</Alert>
                <Link to="/login" className="text-center text-md font-medium">
                  {t('auth.backToSignIn')}
                </Link>
              </div>
            ) : (
              <Form method="post" className="flex flex-col gap-5">
                {actionData?.errorCode && (
                  <Alert tone="danger">
                    {t(`errors.${actionData.errorCode}`, {
                      defaultValue: t('errors.UNKNOWN'),
                    })}
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
                />

                <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
                  {submitting ? t('auth.sending') : t('auth.sendResetLink')}
                </Button>

                <Link to="/login" className="text-center text-sm">
                  {t('auth.backToSignIn')}
                </Link>
              </Form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
