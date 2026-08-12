import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../lib/response';
import { passwordResetLimiter } from '../../middleware/rate-limit';
import { validate } from '../../middleware/validate';
import * as invitations from './invitations.service';

/**
 * Public invitation endpoints.
 *
 * Deliberately outside `authenticate` — the whole point is that the person
 * clicking the link may not have an account yet. Rate limited for the same
 * reason password reset is: an unauthenticated endpoint that touches user
 * records is worth throttling.
 */
export const invitationsRouter = Router();

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

const previewSchema = z.object({ token: z.string().min(20).max(200) });

const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  // Both optional: an existing user supplies neither, a new one supplies both.
  // Which is required is decided by the service, since only it knows whether
  // the email already has an account.
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(12).max(200).optional(),
});

invitationsRouter.get(
  '/preview',
  passwordResetLimiter,
  validate(previewSchema, 'query'),
  handle(async (req, res) => {
    const { token } = req.query as unknown as z.infer<typeof previewSchema>;
    sendSuccess(res, await invitations.previewInvitation(token));
  }),
);

invitationsRouter.post(
  '/accept',
  passwordResetLimiter,
  validate(acceptSchema),
  handle(async (req, res) => {
    const body = req.body as z.infer<typeof acceptSchema>;
    sendSuccess(res, await invitations.acceptInvitation(body.token, body));
  }),
);
