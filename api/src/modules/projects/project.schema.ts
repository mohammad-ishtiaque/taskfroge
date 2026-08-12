import { Role, VisibilityPreset } from '@prisma/client';
import { z } from 'zod';

/**
 * A project key is what people say out loud and paste into commit messages, so
 * it is constrained hard: 2–8 uppercase letters, nothing else. Lowercase input
 * is upcased rather than rejected — a PM typing "web" means WEB.
 */
const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'At least 2 characters')
  .max(8, 'At most 8 characters')
  .regex(/^[A-Z]+$/, 'Letters only — no digits, spaces or punctuation');

const visibility = z.object({
  preset: z.nativeEnum(VisibilityPreset).default(VisibilityPreset.OPEN),
  showBoard: z.boolean().default(true),
  showAssignees: z.boolean().default(true),
  showDueDates: z.boolean().default(true),
  // Off by default even under OPEN. See docs/04-client-visibility.md §3.
  showTimeTracking: z.boolean().default(false),
  showBlockedReasons: z.boolean().default(true),
  showAttachments: z.boolean().default(true),
});

const PROJECT_STATUS = z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
const PROJECT_PRIORITY = z.enum(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .nullable()
  // The regex only proves the *shape*. "2026-13-45" matches it perfectly and
  // is not a date — it reached Prisma as an Invalid Date and came back a 500.
  .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), {
    message: 'That is not a real date',
  });

export const createProjectSchema = z.object({
  /** Every project lives in exactly one workspace — one client's world. */
  workspaceId: z.string().uuid('Choose a workspace'),
  name: z.string().trim().min(2, 'Give the project a name').max(120),
  key: projectKey,
  description: z.string().trim().max(2_000).optional(),
  status: PROJECT_STATUS.optional(),
  priority: PROJECT_PRIORITY.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  leadId: z.string().uuid().nullable().optional(),
  memberIds: z.array(z.string().uuid()).max(50).default([]),
  visibility: visibility.optional(),
  /** Emails to invite while creating. Empty is fine — invite later. */
  invites: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email().max(255),
        role: z.nativeEnum(Role),
      }),
    )
    .max(25)
    .default([]),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  status: PROJECT_STATUS.optional(),
  priority: PROJECT_PRIORITY.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  leadId: z.string().uuid().nullable().optional(),
  // `key` is absent on purpose: it is immutable once set, because changing it
  // would orphan every task reference already pasted into a chat or a commit.
  // `workspaceId` likewise — moving a project between clients would move its
  // whole history into someone else's view.
});

export const visibilitySchema = visibility;

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: z.nativeEnum(Role),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type VisibilityInput = z.infer<typeof visibilitySchema>;
export type InviteInput = z.infer<typeof inviteSchema>;

/**
 * Preset → the six toggles.
 *
 * Choosing a preset writes concrete values rather than leaving the columns to
 * be interpreted later, so a query never has to know what OPEN means.
 */
export function togglesForPreset(preset: VisibilityPreset): Omit<VisibilityInput, 'preset'> {
  switch (preset) {
    case VisibilityPreset.OPEN:
      return {
        showBoard: true,
        showAssignees: true,
        showDueDates: true,
        showTimeTracking: false,
        showBlockedReasons: true,
        showAttachments: true,
      };
    case VisibilityPreset.SUMMARY:
      return {
        showBoard: false,
        showAssignees: false,
        showDueDates: true,
        showTimeTracking: false,
        showBlockedReasons: false,
        showAttachments: true,
      };
    case VisibilityPreset.CUSTOM:
    default:
      // Custom starts from Open and the PM adjusts from there.
      return togglesForPreset(VisibilityPreset.OPEN);
  }
}
