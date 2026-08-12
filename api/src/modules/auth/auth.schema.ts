import { z } from 'zod';

/**
 * Password policy: length only.
 *
 * Composition rules ("one uppercase, one symbol") push people towards
 * `Password1!` and are worse than a length minimum. NIST dropped them in 2017.
 * Twelve characters, and nothing else demanded.
 */
const password = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200, 'That is longer than we can store');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(255);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(200),
});

export const registerSchema = z.object({
  email,
  password,
  name: z.string().trim().min(2, 'Enter your name').max(120),
  organizationName: z.string().trim().min(2).max(120),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password,

  /**
   * The secret held by the browser that *started* this reset, forwarded by the
   * web tier from its own httpOnly cookie. Proves the person finishing is the
   * person who asked.
   */
  challenge: z.string().min(20).max(200).optional(),

  /**
   * The cross-device escape hatch: the 6-digit code from the email, typed into
   * whichever browser is actually being held. Exactly six digits — a length
   * check here keeps malformed input away from the comparison.
   */
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the email')
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

/** A uuid, so a malformed id is a 400 rather than a database error. */
export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
