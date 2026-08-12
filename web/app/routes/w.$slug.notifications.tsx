import { Form, Link, useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/w.$slug.notifications';
import { Card, EmptyState } from '~/components/ui/Card';
import { Icon, type IconName } from '~/components/ui/Icon';
import {
  listNotifications,
  markNotificationRead,
  markNotificationsRead,
} from '~/data/gateway.server';
import { PushToggle } from '~/components/PushToggle';
import { callApi } from '~/lib/api.server';
import { formatRelative } from '~/lib/format';
import { toErrorCode } from '~/lib/api.server';

const ICONS: Record<string, IconName> = {
  ASSIGNED: 'user',
  MENTIONED: 'messageSquare',
  STATUS_CHANGED: 'checkCircle',
  DUE_SOON: 'clock',
  OVERDUE: 'alertTriangle',
  COMMENT: 'messageSquare',
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const [{ notifications }, push] = await Promise.all([
    listNotifications(request),
    // Null when the server has no VAPID keys, which is how the switch knows to
    // explain itself rather than offer a control that quietly does nothing.
    callApi<{ publicKey: string | null }>('/notifications/push/key', { request }).catch(() => ({
      publicKey: null,
    })),
  ]);

  return { slug: params.slug!, notifications, pushPublicKey: push.publicKey };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const id = String(form.get('id') ?? '');

  try {
    // One, or all. Opening a notification should clear that notification;
    // before this the only option was "mark all read", so dealing with one
    // thing meant dismissing eleven.
    if (id) await markNotificationRead(request, id);
    else await markNotificationsRead(request);
  } catch (error) {
    return { errorCode: toErrorCode(error) };
  }

  return { ok: true as const };
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const fetcher = useFetcher();
  const { notifications, slug } = loaderData;
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-content-primary">{t('notifications.title')}</h1>
          <p className="mt-1 text-md text-content-secondary">
            {unread > 0 ? t('notifications.unread', { count: unread }) : t('notifications.allRead')}
          </p>
        </div>

        {unread > 0 && (
          <Form method="post">
            <button type="submit" className="inline-flex items-center gap-2 rounded-md border border-stroke-subtle px-4 py-2.5 text-md font-medium text-content-secondary hover:bg-surface-hover">
              <Icon name="check" size={15} />
              {t('notifications.markAllRead')}
            </button>
          </Form>
        )}
      </header>

      {/* Above the list rather than buried in settings: this is the screen
          someone is on when they think "I wish I had known sooner". */}
      <PushToggle publicKey={loaderData.pushPublicKey} />

      <Card>
        {notifications.length === 0 ? (
          <EmptyState icon="bell" title={t('notifications.none')} hint={t('notifications.noneHint')} />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {notifications.map((n) => (
              <li key={n.id} className="relative">
                {/* Marking it read rides alongside the navigation rather than
                    replacing it: a fetcher submits in the background while the
                    link does what a link does. Wrapping the row in a form
                    instead would have cost the middle-click and the
                    open-in-new-tab that people actually use on a list. */}
                <Link
                  to={`/w/${slug}/tasks/${n.taskKey}`}
                  onClick={() => {
                    if (!n.readAt) fetcher.submit({ id: n.id }, { method: 'post' });
                  }}
                  className={
                    n.readAt
                      ? 'flex items-start gap-3 px-card py-4 no-underline hover:bg-surface-hover'
                      : 'flex items-start gap-3 bg-brand-50/40 px-card py-4 no-underline hover:bg-surface-hover'
                  }
                >
                  <span
                    aria-hidden
                    className={
                      n.kind === 'OVERDUE'
                        ? 'flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger-50 text-danger-600'
                        : 'flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-content-secondary'
                    }
                  >
                    <Icon name={ICONS[n.kind] ?? 'bell'} size={16} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-md text-content-primary">
                      {t(`notifications.kind.${n.kind}`, {
                        taskKey: n.taskKey,
                        actor: n.actorName ?? '',
                      })}
                    </span>
                    <span className="mt-0.5 block truncate text-md font-medium text-content-secondary">
                      {n.taskTitle}
                    </span>
                    <span className="mt-1 block text-sm text-content-tertiary">
                      {formatRelative(n.createdAt, i18n.language)}
                    </span>
                  </span>

                  {!n.readAt && <span aria-label={t('notifications.new')} className="mt-2 size-2 shrink-0 rounded-full bg-brand-600" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
