import { data } from 'react-router';

import type { Route } from './+types/push.unsubscribe';
import { callApi, toErrorCode } from '~/lib/api.server';
import { requireUser } from '~/lib/session.server';

/**
 * Turning notifications off.
 *
 * Removing the row matters as much as revoking the browser permission: a
 * subscription the server still holds is one it keeps trying to deliver to,
 * and a person who turned notifications off and still gets one has been told
 * the switch does not work.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);

  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;

  if (!body?.endpoint) {
    return data({ subscribed: true, error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  try {
    await callApi('/notifications/push/unsubscribe', {
      method: 'POST',
      request,
      body: { endpoint: body.endpoint },
    });
  } catch (error) {
    return data({ subscribed: true, error: toErrorCode(error) }, { status: 502 });
  }

  return { subscribed: false };
}
