import { Form } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.settings';
import { Card, CardHeader } from '~/components/ui/Card';
import { Icon } from '~/components/ui/Icon';
import { getWorkspace, updateWorkspace } from '~/data/gateway.server';
import { requireUser } from '~/lib/session.server';
import { toErrorCode } from '~/lib/api.server';

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);

  return {
    workspace: await getWorkspace(request, params.slug!),
    canEdit: user.role === 'PROJECT_MANAGER',
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();

  try {
    await updateWorkspace(request, params.slug!, {
      name: String(form.get('name') ?? '').trim(),
      clientName: String(form.get('clientName') ?? '').trim(),
    });
    return { saved: true as const };
  } catch (error) {
    return { errorCode: toErrorCode(error) };
  }
}

export default function WorkspaceSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { workspace, canEdit } = loaderData;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-content-primary">{t('nav.settings')}</h1>
        <p className="mt-1 text-md text-content-secondary">{t('settings.workspaceSubtitle')}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('settings.workspaceDetails')} />
          <Form method="post" className="space-y-4 p-card">
            <label className="block">
              <span className="text-md font-medium">{t('settings.workspaceName')}</span>
              <input name="name" defaultValue={workspace.name} disabled={!canEdit} className="mt-1.5 field text-md disabled:opacity-60 " />
            </label>

            <label className="block">
              <span className="text-md font-medium">{t('settings.clientName')}</span>
              <input name="clientName" defaultValue={workspace.clientName} disabled={!canEdit} className="mt-1.5 field text-md disabled:opacity-60 " />
            </label>

            <label className="block">
              <span className="text-md font-medium">{t('settings.urlSlug')}</span>
              <input name="slug" defaultValue={workspace.slug} disabled className="field mt-1.5 bg-surface-sunken font-mono opacity-70" />
              {/* Renaming a workspace must not break saved links, so the slug
                  is fixed once created. */}
              <span className="mt-1 block text-sm text-content-tertiary">{t('settings.urlSlugHint')}</span>
            </label>

            {canEdit && (
              <button type="submit" className="inline-flex items-center gap-2 btn-primary">
                <Icon name="save" size={15} />
                {t('common.saveChanges')}
              </button>
            )}
          </Form>
        </Card>

      </div>
    </div>
  );
}
