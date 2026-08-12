import webpush from 'web-push';

import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

/* ==========================================================================
   Web push
   --------------------------------------------------------------------------
   A push is a copy of a notification that has already been written to the
   database. That ordering is deliberate: the row is the record, and the push
   is a best-effort nudge towards it. If a push fails the person still sees the
   notification next time they open the app; if the row failed to write there
   would be nothing to open.

   ── What a payload may contain ──────────────────────────────────────────
   A push lands on a lock screen. It is read by whoever is holding the phone,
   which is not always the person the phone belongs to, and it is read without
   signing in.

   So the payload carries the least that is still useful, and the decision
   about *how* little is made here rather than in the service worker. A rule
   enforced in the browser is a rule enforced on the attacker's own machine.

   Specifically: a client never receives a task title in a push. Client
   visibility is per project and per task and can change after the notification
   was written, and the cost of getting it wrong is a hidden task's name on a
   customer's lock screen. Managers and developers get the title, because they
   are entitled to it and a notification without it is useless.
   ========================================================================== */

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
  /** Where clicking it should land. Relative, resolved against the app origin. */
  url: string;
  /** Same tag replaces rather than stacks. Keyed by task, so ten moves on one
      task are one notification rather than ten. */
  tag?: string;
}

export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!configured) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
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

        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { lastSeenAt: new Date() },
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        // 404 and 410 are the push service telling us this browser is gone —
        // uninstalled, permission revoked, profile deleted. Deleting the row is
        // the correct response; retrying forever is how a sender ends up
        // spending most of its time on subscriptions that will never work.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: subscription.id } })
            .catch(() => undefined);
          return;
        }

        // Anything else is transient or our problem. Logged, never thrown: the
        // action that triggered this already succeeded, and failing it now
        // because a phone was unreachable would be the worse outcome.
        logger.error({ err: error, userId, status }, 'Push send failed');
      }
    }),
  );
}

/* ── Subscriptions ──────────────────────────────────────────────────────── */

export async function saveSubscription(
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; label?: string },
): Promise<void> {
  // Upsert on the endpoint, not create. A browser that re-subscribes — after a
  // permission reset, a key rotation, or simply a second visit — presents the
  // same endpoint, and a plain create would either fail or leave a duplicate
  // that every future send has to try.
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
    },
    update: {
      // Including `userId`: a shared device where one person signs out and
      // another signs in reuses the endpoint, and the notifications must
      // follow the person who is now signed in.
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
      lastSeenAt: new Date(),
    },
  });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  // Scoped to the caller, so one person cannot unsubscribe another's device by
  // guessing an endpoint.
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function countSubscriptions(userId: string): Promise<number> {
  return prisma.pushSubscription.count({ where: { userId } });
}

export const pushConfigured = configured;
