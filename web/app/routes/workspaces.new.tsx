import { Form, Link, redirect } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/workspaces.new';
import { Icon } from '~/components/ui/Icon';
import { toErrorCode } from '~/lib/api.server';
import { createWorkspace } from '~/data/gateway.server';
import { defaultWorkspaceSlug } from '~/lib/shell.server';

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  try {
    const workspace = await createWorkspace(request, {
      name: String(form.get('name') ?? '').trim(),
      clientName: String(form.get('clientName') ?? '').trim(),
    });
    return redirect(`/w/${workspace.slug}`);
  } catch (error) {
    return { errorCode: toErrorCode(error) };
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  return { back: await defaultWorkspaceSlug(request) };
}

/**
 * Create a workspace — one per client.
 *
 * Outside the workspace layout on purpose: you may be creating your first one,
 * and a sidebar listing workspaces is not much use on the screen where you
 * have none.
 */
export default function NewWorkspace({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-page-x py-page-y">
      <header>
        <h1 className="text-3xl font-bold text-content-primary">{t('workspace.create')}</h1>
        <p className="mt-1 text-md text-content-secondary">{t('workspace.createHint')}</p>
      </header>

      {actionData?.errorCode && (
        <p role="alert" className="rounded-md border border-danger-500 bg-danger-50 px-4 py-3 text-md text-danger-700">
          {t(`errors.${actionData.errorCode}`, { defaultValue: t('errors.UNKNOWN') })}
        </p>
      )}

      <Form method="post" className="space-y-4 rounded-lg border border-stroke-subtle bg-surface-raised p-card">
        <label className="block">
          <span className="text-md font-medium">{t('settings.workspaceName')}</span>
          <input name="name" required maxLength={80} placeholder={t('workspace.namePlaceholder')} className="mt-1.5 field text-md " />
        </label>

        <label className="block">
          <span className="text-md font-medium">{t('settings.clientName')}</span>
          <input name="clientName" required maxLength={120} placeholder={t('workspace.clientPlaceholder')} className="mt-1.5 field text-md " />
        </label>

        <div className="flex justify-end gap-3 pt-2">
          {loaderData.back && (
            <Link to={`/w/${loaderData.back}`} className="rounded-md border border-stroke-subtle px-4 py-2.5 text-md font-medium text-content-secondary no-underline hover:bg-surface-hover">
              {t('common.cancel')}
            </Link>
          )}
          <button type="submit" className="btn-primary">
            <Icon name="plus" size={16} />
            {t('workspace.create')}
          </button>
        </div>
      </Form>
    </main>
  );
}
