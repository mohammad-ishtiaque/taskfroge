export const defaultSchemaOptions = {
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: any, ret: any) => {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: any, ret: any) => {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      delete ret.__v;
      return ret;
    },
  },
};

// Enums as both Values and Types
export const Role = {
  CLIENT: 'CLIENT',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  DEVELOPER: 'DEVELOPER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const MemberStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];

export const ProjectStatus = {
  PLANNING: 'PLANNING',
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const Priority = {
  URGENT: 'URGENT',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const TaskStatus = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  IN_REVIEW: 'IN_REVIEW',
  BLOCKED: 'BLOCKED',
  DONE: 'DONE',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskType = {
  TASK: 'TASK',
  BUG: 'BUG',
  STORY: 'STORY',
  CHORE: 'CHORE',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const ActivityKind = {
  TASK_CREATED: 'TASK_CREATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ASSIGNED: 'ASSIGNED',
  COMMENTED: 'COMMENTED',
  DUE_DATE_CHANGED: 'DUE_DATE_CHANGED',
  BLOCKED: 'BLOCKED',
  UNBLOCKED: 'UNBLOCKED',
  VISIBILITY_CHANGED: 'VISIBILITY_CHANGED',
} as const;
export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];

export const NotificationKind = {
  ASSIGNED: 'ASSIGNED',
  MENTIONED: 'MENTIONED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  DUE_SOON: 'DUE_SOON',
  OVERDUE: 'OVERDUE',
  COMMENT: 'COMMENT',
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const VisibilityPreset = {
  OPEN: 'OPEN',
  SUMMARY: 'SUMMARY',
  CUSTOM: 'CUSTOM',
} as const;
export type VisibilityPreset = (typeof VisibilityPreset)[keyof typeof VisibilityPreset];

// Model Exports
export * from './Organization';
export * from './User';
export * from './Membership';
export * from './Session';
export * from './PasswordResetToken';
export * from './EmailVerification';
export * from './Workspace';
export * from './Project';
export * from './Task';
export * from './Comment';
export * from './Activity';
export * from './Notification';
export * from './ProjectMember';
export * from './ProjectVisibility';
export * from './Invitation';
export * from './PushSubscription';
