import { Router } from 'express';
import { env } from '../../config/env';
import { AppError, ErrorCode } from '../../lib/errors';
import { sendSuccess } from '../../lib/response';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { loginLimiter, passwordResetLimiter } from '../../middleware/rate-limit';
import { validate } from '../../middleware/validate';
import * as service from './auth.service';
import { describeRequest } from './challenge';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
  type ResetPasswordInput,
} from './auth.schema';

export const authRouter = Router();

/** Everything an async handler needs, without try/catch in every route. */
const handle =
  <T>(fn: (...args: Parameters<Parameters<Router['get']>[1]>) => Promise<T>) =>
  (...args: Parameters<Parameters<Router['get']>[1]>) => {
    const next = args[2];
    void fn(...args).catch(next);
  };

/**
 * Creating a workspace, not joining one.
 *
 * Gated behind ALLOW_REGISTRATION so a self-hosted instance can be closed once
 * its organisation exists. Team members arrive by invitation instead.
 */
authRouter.post(
  '/register',
  loginLimiter,
  (_req, _res, next) => {
    next(
      env.ALLOW_REGISTRATION
        ? undefined
        : new AppError({
            code: ErrorCode.REGISTRATION_DISABLED,
            status: 403,
            message: 'Registration is closed on this server',
          }),
    );
  },
  validate(registerSchema),
  handle(async (req, res) => {
    const body = req.body as RegisterInput;
    const result = await service.register(body, {
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });
    sendSuccess(res, result, 201);
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  handle(async (req, res) => {
    const body = req.body as LoginInput;
    const result = await service.login(body, {
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });
    sendSuccess(res, result);
  }),
);

authRouter.post(
  '/refresh',
  validate(refreshSchema),
  handle(async (req, res) => {
    const body = req.body as RefreshInput;
    sendSuccess(res, await service.refresh(body.refreshToken));
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  handle(async (req, res) => {
    await service.logout(requireAuth(req).sessionId);
    sendSuccess(res, { loggedOut: true });
  }),
);

authRouter.post(
  '/logout-all',
  authenticate,
  handle(async (req, res) => {
    const revoked = await service.logoutEverywhere(requireAuth(req).userId);
    sendSuccess(res, { revokedSessions: revoked });
  }),
);

authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  validate(forgotPasswordSchema),
  handle(async (req, res) => {
    const body = req.body as ForgotPasswordInput;

    const { challenge } = await service.requestPasswordReset(
      body.email,
      `${env.WEB_ORIGIN}/reset-password`,
      describeRequest(req),
    );

    // Always the same response, whether or not the address exists — including
    // the challenge, which is returned for unknown addresses too. A response
    // that changes shape when an account exists is an enumeration tool, and
    // this endpoint takes an email address from anyone.
    //
    // The web tier stores this in an httpOnly cookie on the browser that asked.
    // It cannot be set here: every request to this API arrives from the web
    // server rather than the browser, so a `Set-Cookie` written here would be
    // stored by the wrong machine.
    sendSuccess(res, {
      message: 'If that email is registered, a reset link is on its way.',
      challenge,
    });
  }),
);

authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  validate(resetPasswordSchema),
  handle(async (req, res) => {
    const body = req.body as ResetPasswordInput;

    await service.resetPassword(body.token, body.password, {
      challenge: body.challenge,
      otp: body.otp,
    });

    sendSuccess(res, { message: 'Your password has been changed. Please sign in.' });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as ChangePasswordInput;

    await service.changePassword(
      auth.userId,
      auth.sessionId,
      body.currentPassword,
      body.newPassword,
    );

    sendSuccess(res, { message: 'Password updated.' });
  }),
);

/** Who am I — used by the web app on every page load to resolve the shell. */
authRouter.get(
  '/me',
  authenticate,
  handle(async (req, res) => {
    const auth = requireAuth(req);
    sendSuccess(res, {
      userId: auth.userId,
      email: auth.email,
      orgId: auth.orgId,
      role: auth.role,
    });
  }),
);
