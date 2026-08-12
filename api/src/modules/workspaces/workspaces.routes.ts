import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { env } from '../../config/env';

import { sendSuccess } from '../../lib/response';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as workspaces from './workspaces.service';
import * as notifications from '../notifications/notifications.service';
import * as push from '../notifications/push.service';
import { getDashboard } from '../dashboard/dashboard.service';
import { createWorkspaceSchema, updateWorkspaceSchema } from '../tasks/task.schema';

export const workspacesRouter = Router();

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

workspacesRouter.use(authenticate);

workspacesRouter.get(
  '/',
  handle(async (req, res) => {
    sendSuccess(res, await workspaces.listWorkspaces(requireAuth(req)));
  }),
);

workspacesRouter.post(
  '/',
  validate(createWorkspaceSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const workspace = await workspaces.createWorkspace(auth, req.body as { name: string; clientName: string });
    sendSuccess(res, workspace, 201);
  }),
);

workspacesRouter.get(
  '/:slug',
  handle(async (req, res) => {
    sendSuccess(res, await workspaces.getWorkspaceBySlug(requireAuth(req), req.params.slug!));
  }),
);

workspacesRouter.patch(
  '/:slug',
  validate(updateWorkspaceSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const workspace = await workspaces.updateWorkspace(auth, req.params.slug!, req.body as { name?: string });
    sendSuccess(res, workspace);
  }),
);

/**
 * The dashboard, per workspace.
 *
 * One endpoint that returns a different shape per role rather than three URLs:
 * the caller's role is already known from the token, and a client requesting
 * `/dashboard/pm` would be a permission check we do not need to write.
 */
workspacesRouter.get(
  '/:slug/dashboard',
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const workspace = await workspaces.getWorkspaceBySlug(auth, req.params.slug!);
    sendSuccess(res, await getDashboard(auth, workspace.id));
  }),
);

/* ── Notifications — not workspace-scoped, but mounted alongside ────────── */

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  handle(async (req, res) => {
    const auth = requireAuth(req);
    sendSuccess(res, {
      notifications: await notifications.listNotifications(auth),
      unread: await notifications.unreadCount(auth),
    });
  }),
);

notificationsRouter.post(
  '/read',
  handle(async (req, res) => {
    sendSuccess(res, { marked: await notifications.markAllRead(requireAuth(req)) });
  }),
);

notificationsRouter.post(
  '/:id/read',
  handle(async (req, res) => {
    await notifications.markRead(requireAuth(req), req.params.id!);
    sendSuccess(res, { read: true });
  }),
);

/* ── Push subscriptions ─────────────────────────────────────────────────────
   Mounted on the notifications router because that is what they are: the same
   notifications, delivered to a device instead of a badge. */

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
  /** "Chrome on Android", so a person can tell which device to remove later. */
  label: z.string().trim().max(120).optional(),
});

notificationsRouter.get(
  '/push/key',
  handle(async (req, res) => {
    void req;
    // The public half of the VAPID pair. Public by definition — the browser
    // needs it to subscribe, and it is in every push request anyway. `null`
    // when push is not configured, so the UI can say so rather than offering a
    // switch that silently does nothing.
    sendSuccess(res, { publicKey: env.VAPID_PUBLIC_KEY ?? null });
  }),
);

notificationsRouter.post(
  '/push/subscribe',
  validate(pushSubscriptionSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as z.infer<typeof pushSubscriptionSchema>;

    await push.saveSubscription(auth.userId, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      label: body.label,
    });

    sendSuccess(res, { subscribed: true }, 201);
  }),
);

notificationsRouter.post(
  '/push/unsubscribe',
  validate(z.object({ endpoint: z.string().url().max(2000) })),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    await push.removeSubscription(auth.userId, (req.body as { endpoint: string }).endpoint);
    sendSuccess(res, { subscribed: false });
  }),
);
