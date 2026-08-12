import { Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/reset-password';
import { ApiError, callApi } from '~/lib/api.server';
import { readResetChallenge, resetChallenge } from '~/lib/challenge.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { Field } from '~/components/ui/Field';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Choose a new password · TaskForge' }];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');
  const otp = String(formData.get('otp') ?? '').trim();

  if (!token) return { errorCode: 'RESET_TOKEN_INVALID' as const };

  // Checked here rather than server-side because the API has no concept of a
  // confirmation field — it is a UI affordance against typos, not a rule.
  if (password !== confirm) return { mismatch: true as const };

  try {
    await callApi('/auth/reset-password', {
      method: 'POST',
      body: {
        token,
        password,
        // The proof that this is the browser that asked. Absent when the link
        // was opened somewhere else — forwarded, or read on a phone — and the
        // API then falls back to the code below.
        challenge: await readResetChallenge(request),
        otp: otp || undefined,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { errorCode: error.code, fieldIssues: error.fieldIssues };
    }
    throw error;
  }

  // The challenge has done its job. Leaving it behind would be a credential
  // sitting in a browser with nothing left to open.
  return redirect('/login?reset=1', {
    headers: { 'Set-Cookie': await resetChallenge.serialize('', { maxAge: 0 }) },
  });
}

export default function ResetPassword({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const token = searchParams.get('token') ?? '';
  const submitting = navigation.formAction === '/reset-password';
  const passwordIssue = actionData?.fieldIssues?.password?.[0];

  // The link is real, but this browser is not the one that asked for it.
  const needsCode = actionData?.errorCode === 'RESET_CHALLENGE_REQUIRED';

  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <header className="flex h-topbar items-center justify-end px-page-x">
        <LocaleSwitcher />
      </header>

      <main className="flex flex-1 items-start justify-center px-page-x pb-16 pt-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl">{t('auth.resetTitle')}</h1>
            <p className="mt-2 text-md text-content-secondary">{t('auth.resetSubtitle')}</p>
          </div>

          <div className="rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-sm">
            {!token ? (
              <div className="flex flex-col gap-5">
                <Alert tone="danger">{t('auth.missingResetToken')}</Alert>
                <Link to="/forgot-password" className="text-center text-md font-medium">
                  {t('auth.forgotTitle')}
                </Link>
              </div>
            ) : (
              <Form method="post" className="flex flex-col gap-5">
                <input type="hidden" name="token" value={token} />

                {actionData?.errorCode && (
                  <Alert tone="danger">
                    {t(`errors.${actionData.errorCode}`, {
                      defaultValue: t('errors.UNKNOWN'),
                    })}
                  </Alert>
                )}

                <Field
                  label={t('auth.newPassword')}
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  autoFocus
                  minLength={12}
                  error={passwordIssue}
                />

                <Field
                  label={t('auth.confirmPassword')}
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  error={actionData?.mismatch ? t('auth.passwordsDoNotMatch') : undefined}
                />

                {/* Shown only after the server says this browser is not the one
                    that asked — which is the normal outcome for someone who
                    requested the reset on a laptop and opened the mail on a
                    phone. Asking for the code up front would put a hurdle in
                    front of everybody to catch the minority. */}
                {needsCode && (
                  <Field
                    label={t('auth.resetCode')}
                    hint={t('auth.resetCodeHint')}
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                  />
                )}

                <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
                  {t('auth.setPassword')}
                </Button>
              </Form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
