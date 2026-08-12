import { z } from 'zod';

/* Validation lives beside the module it guards, and every limit here has a
   matching maxLength on the form. A rule enforced only on the server costs the
   user a round trip to discover. */

const TASK_TYPE = z.enum(['TASK', 'BUG', 'STORY', 'CHORE']);
const PRIORITY = z.enum(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const STATUS = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE']);

/** An ISO date, or null to clear it. Rejects "tomorrow" and 32 January alike. */
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

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(200),
  description: z.string().max(8000).optional(),
  type: TASK_TYPE.optional(),
  priority: PRIORITY.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: isoDate.optional(),
  // 500 hours is roughly three months of one person. Past that, it is a
  // project rather than a task, and the number is almost certainly a typo.
  estimateHours: z.number().min(0).max(500).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(8000).nullable().optional(),
    type: TASK_TYPE.optional(),
    priority: PRIORITY.optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    dueDate: isoDate.optional(),
    estimateHours: z.number().min(0).max(500).nullable().optional(),
    loggedHours: z.number().min(0).max(9999).optional(),
    clientVisible: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const updateStatusSchema = z.object({
  status: STATUS,
  blockedReason: z.string().trim().max(280).optional(),
});

export const listTasksSchema = z.object({
  status: STATUS.optional(),
  type: TASK_TYPE.optional(),
  priority: PRIORITY.optional(),
  assigneeId: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  includeSubtasks: z.coerce.boolean().optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(8000),
  isInternal: z.boolean().optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  clientName: z.string().trim().min(1).max(120),
});

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    clientName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type UpdateStatusBody = z.infer<typeof updateStatusSchema>;
export type ListTasksQuery = z.infer<typeof listTasksSchema>;
