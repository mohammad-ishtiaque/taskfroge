import type { VisibilityPreset } from '../../models';
import { z } from 'zod';

const VISIBILITY_PRESET = z.enum(['OPEN', 'SUMMARY', 'CUSTOM']);
const ROLE_ENUM = z.enum(['CLIENT', 'PROJECT_MANAGER', 'DEVELOPER']);

const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'At least 2 characters')
  .max(8, 'At most 8 characters')
  .regex(/^[A-Z]+$/, 'Letters only — no digits, spaces or punctuation');

const visibility = z.object({
  preset: VISIBILITY_PRESET.default('OPEN'),
  showBoard: z.boolean().default(true),
  showAssignees: z.boolean().default(true),
  showDueDates: z.boolean().default(true),
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
  .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), {
    message: 'That is not a real date',
  });

export const createProjectSchema = z.object({
  workspaceId: z.string().min(1, 'Choose a workspace'),
  name: z.string().trim().min(2, 'Give the project a name').max(120),
  key: projectKey,
  description: z.string().trim().max(2_000).optional(),
  status: PROJECT_STATUS.optional(),
  priority: PROJECT_PRIORITY.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  leadId: z.string().nullable().optional(),
  memberIds: z.array(z.string()).max(50).default([]),
  visibility: visibility.optional(),
  invites: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email().max(255),
        role: ROLE_ENUM,
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
  leadId: z.string().nullable().optional(),
});

export const visibilitySchema = visibility;

export const addMemberSchema = z.object({
  userId: z.string().min(1),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: ROLE_ENUM,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type VisibilityInput = z.infer<typeof visibilitySchema>;
export type InviteInput = z.infer<typeof inviteSchema>;

export function togglesForPreset(preset: VisibilityPreset): Omit<VisibilityInput, 'preset'> {
  switch (preset) {
    case 'OPEN':
      return {
        showBoard: true,
        showAssignees: true,
        showDueDates: true,
        showTimeTracking: false,
        showBlockedReasons: true,
        showAttachments: true,
      };
    case 'SUMMARY':
      return {
        showBoard: false,
        showAssignees: false,
        showDueDates: true,
        showTimeTracking: false,
        showBlockedReasons: false,
        showAttachments: true,
      };
    case 'CUSTOM':
    default:
      return togglesForPreset('OPEN');
  }
}
