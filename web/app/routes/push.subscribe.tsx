import { data } from 'react-router';

import type { Route } from './+types/push.subscribe';
import { callApi, toErrorCode } from '~/lib/api.server';
import { requireUser } from '~/lib/session.server';

/**
 * Resource route. The service worker and the notification switch both POST a
 * `PushSubscription` here, and it is forwarded to the API with the caller's
 * bearer token attached.
 *
 * A route rather than a direct browser-to-API call because the access token
 * lives in an httpOnly cookie this server holds — the page has no credential
 * of its own to present, which is the entire point of keeping it that way.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);

  const body: unknown = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return data({ subscribed: false, error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  const subscription = body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

  if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) {
    return data({ subscribed: false, error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  try {
    await callApi('/notifications/push/subscribe', {
      method: 'POST',
      request,
      body: {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        // Derived here rather than sent by the page: it is only ever shown back
        // to the user as "which device is this", and the browser already told
        // us in a header we can trust more than a form field.
        label: describeDevice(request.headers.get('user-agent') ?? ''),
      },
    });
  } catch (error) {
    return data({ subscribed: false, error: toErrorCode(error) }, { status: 502 });
  }

  return { subscribed: true };
}

/** "Chrome on Android". Enough to recognise a device in a list, and no more. */
function describeDevice(ua: string): string {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'A browser';

  const os =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'this device';

  return `${browser} on ${os}`;
}
