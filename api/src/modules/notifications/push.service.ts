import webpush from 'web-push';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { PushSubscription } from '../../models';

const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );
} else {
  logger.warn('VAPID keys are not set — push notifications are disabled');
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!configured) return;

  const subscriptions = await PushSubscription.find({ userId });
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: 60 * 60 * 24 },
        );

        await PushSubscription.findByIdAndUpdate(subscription.id, { lastSeenAt: new Date() });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        if (status === 404 || status === 410) {
          await PushSubscription.findByIdAndDelete(subscription.id).catch(() => undefined);
          return;
        }

        logger.error({ err: error, userId, status }, 'Push send failed');
      }
    }),
  );
}

export async function saveSubscription(
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; label?: string },
): Promise<void> {
  await PushSubscription.findOneAndUpdate(
    { endpoint: input.endpoint },
    {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
      lastSeenAt: new Date(),
    },
    { upsert: true, new: true }
  );
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await PushSubscription.deleteMany({ userId, endpoint });
}

export async function countSubscriptions(userId: string): Promise<number> {
  return PushSubscription.countDocuments({ userId });
}

export const pushConfigured = configured;
