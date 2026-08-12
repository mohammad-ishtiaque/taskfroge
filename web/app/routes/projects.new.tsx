import { useState } from 'react';
import { Form, Link, redirect, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/projects.new';
import { ApiError, callApi } from '~/lib/api.server';
import { requireUser } from '~/lib/session.server';
import { Alert } from '~/components/ui/Alert';
import { Button } from '~/components/ui/Button';
import { Field } from '~/components/ui/Field';
import { AppHeader } from '~/components/layout/AppHeader';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'New project · TaskForge' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);

  // Belt and braces. The API refuses this anyway, but sending a developer to a
  // form they cannot submit is a worse experience than not showing it.
  if (user.role !== 'PROJECT_MANAGER') throw redirect('/projects');

  return { user };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();

  // Invite rows are posted as parallel arrays; zip them and drop the blanks.
  const emails = formData.getAll('inviteEmail').map(String);
  const roles = formData.getAll('inviteRole').map(String);
  const invites = emails
    .map((email, index) => ({ email: email.trim(), role: roles[index] ?? 'DEVELOPER' }))
    .filter((entry) => entry.email.length > 0);

  const preset = String(formData.get('preset') ?? 'OPEN');

  try {
    const result = await callApi<{ project: { key: string } }>('/projects', {
      method: 'POST',
      request,
      body: {
        name: String(formData.get('name') ?? ''),
        key: String(formData.get('key') ?? ''),
        description: String(formData.get('description') ?? '') || undefined,
        invites,
        visibility: {
          preset,
          // Only meaningful for CUSTOM; the API overwrites these from the
          // preset otherwise, so sending them is harmless.
          showBoard: formData.get('showBoard') === 'on',
          showAssignees: formData.get('showAssignees') === 'on',
          showDueDates: formData.get('showDueDates') === 'on',
          showTimeTracking: formData.get('showTimeTracking') === 'on',
          showBlockedReasons: formData.get('showBlockedReasons') === 'on',
          showAttachments: formData.get('showAttachments') === 'on',
        },
      },
    });

    return redirect(`/projects/${result.project.key}`);
  } catch (error) {
    if (error instanceof ApiError) {
      return { errorCode: error.code, fieldIssues: error.fieldIssues };
    }
    throw error;
  }
}

const TOGGLES = [
  'showBoard',
  'showAssignees',
  'showDueDates',
  'showTimeTracking',
  'showBlockedReasons',
  'showAttachments',
] as const;

/** Defaults mirror the API's OPEN preset, including time tracking staying off. */
const OPEN_DEFAULTS: Record<(typeof TOGGLES)[number], boolean> = {
  showBoard: true,
  showAssignees: true,
  showDueDates: true,
  showTimeTracking: false,
  showBlockedReasons: true,
  showAttachments: true,
};

export default function NewProject({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [preset, setPreset] = useState<'OPEN' | 'SUMMARY' | 'CUSTOM'>('OPEN');
  const [inviteRows, setInviteRows] = useState(1);

  const busy = navigation.formAction === '/projects/new';
  const issues = actionData?.fieldIssues;

  return (
    <div className="min-h-dvh bg-surface-canvas">
      <AppHeader user={loaderData.user} />

      <main className="mx-auto max-w-2xl px-page-x py-page-y">
        <Link to="/projects" className="text-sm">
          ← {t('projects.title')}
        </Link>
        <h1 className="mt-4 text-3xl">{t('projects.createTitle')}</h1>

        <Form method="post" className="mt-8 flex flex-col gap-6">
          {actionData?.errorCode && !issues && (
            <Alert tone="danger">
              {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
            </Alert>
          )}

          {/* ── 1. Details ── */}
          <Section step={1} title={t('projects.stepDetails')}>
            <Field
              label={t('projects.name')}
              name="name"
              required
              autoFocus
              maxLength={120}
              error={issues?.name?.[0]}
            />
            {/* Digits and punctuation are rejected as they are typed, so the
                only way to fail this rule is to leave it too short. */}
            <Field
              label={t('projects.key')}
              name="key"
              required
              format="upperAlpha"
              placeholder="WEB"
              minLength={2}
              maxLength={8}
              pattern="[A-Za-z]{2,8}"
              title={t('projects.keyHint')}
              hint={t('projects.keyHint')}
              error={
                issues?.key?.[0] ??
                (actionData?.errorCode === 'ALREADY_EXISTS'
                  ? t('errors.ALREADY_EXISTS')
                  : undefined)
              }
              className="font-mono"
            />
            <Field
              label={t('projects.description')}
              name="description"
              maxLength={2000}
              error={issues?.description?.[0]}
            />
          </Section>

          {/* ── 2. Team ── */}
          <Section step={2} title={t('projects.stepTeam')} hint={t('projects.inviteHint')}>
            {Array.from({ length: inviteRows }, (_, index) => (
              <div key={index} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <Field
                    label={t('projects.inviteEmail')}
                    name="inviteEmail"
                    type="email"
                    maxLength={255}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">{t('projects.inviteRole')}</label>
                  <select
                    name="inviteRole"
                    defaultValue="DEVELOPER"
                    className="field h-9"
                  >
                    <option value="DEVELOPER">{t('roles.DEVELOPER')}</option>
                    <option value="CLIENT">{t('roles.CLIENT')}</option>
                    <option value="PROJECT_MANAGER">{t('roles.PROJECT_MANAGER')}</option>
                  </select>
                </div>
              </div>
            ))}

            <Button variant="ghost" size="sm" className="self-start"
                    onClick={() => setInviteRows((n) => Math.min(n + 1, 10))}>
              + {t('projects.addAnother')}
            </Button>
          </Section>

          {/* ── 3. Client visibility ── */}
          <Section step={3} title={t('projects.stepVisibility')}>
            <div className="flex flex-col gap-2">
              {(['OPEN', 'SUMMARY', 'CUSTOM'] as const).map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-start gap-3 rounded-md border
                             border-stroke-subtle p-3 hover:bg-surface-hover"
                >
                  <input
                    type="radio"
                    name="preset"
                    value={option}
                    checked={preset === option}
                    onChange={() => setPreset(option)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-md font-medium">
                      {t(`projects.preset${option.charAt(0)}${option.slice(1).toLowerCase()}`)}
                    </span>
                    <span className="block text-sm text-content-secondary">
                      {t(`projects.preset${option.charAt(0)}${option.slice(1).toLowerCase()}Hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {preset === 'CUSTOM' && (
              <fieldset className="mt-2 flex flex-col gap-2 border-s-2 border-stroke ps-4">
                {TOGGLES.map((toggle) => (
                  <label key={toggle} className="flex items-center gap-2 text-md">
                    <input type="checkbox" name={toggle} defaultChecked={OPEN_DEFAULTS[toggle]} />
                    {t(`projects.${toggle}`)}
                  </label>
                ))}
              </fieldset>
            )}

            {/* Stated, never a toggle — see docs/04-client-visibility.md §1. */}
            <p className="mt-2 rounded-md bg-surface-sunken px-3 py-2 text-sm text-content-secondary">
              {t('projects.internalNote')}
            </p>
          </Section>

          <Button type="submit" variant="primary" size="lg" loading={busy} className="self-start">
            {busy ? t('projects.creating') : t('projects.create')}
          </Button>
        </Form>
      </main>
    </div>
  );
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-stroke-subtle bg-surface-raised p-card shadow-xs">
      <p className="label-caps">{t('projects.step', { n: step })}</p>
      <h2 className="mt-1 text-xl">{title}</h2>
      {hint && <p className="mt-1 text-md text-content-secondary">{hint}</p>}
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}
