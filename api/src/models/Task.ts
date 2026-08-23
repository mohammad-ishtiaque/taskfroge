import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions, TaskType, TaskStatus, Priority } from './index';

export interface ITask {
  id: string;
  orgId: any;
  projectId: any;
  parentId?: any;
  number: number;
  key: string;
  title: string;
  description?: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  assigneeId?: any;
  reporterId: any;
  dueDate?: Date | null;
  estimateHours?: number | null;
  loggedHours: number;
  blockedReason?: string | null;
  clientVisible: boolean;
  labels: string[];
  reminderSentAt?: Date | null;
  overdueNotified: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
}

export type TaskDocument = Document & ITask;

const taskSchema = new Schema<TaskDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    number: { type: Number, required: true },
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    type: {
      type: String,
      enum: ['TASK', 'BUG', 'STORY', 'CHORE'],
      default: 'TASK',
    },
    status: {
      type: String,
      enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'],
      default: 'TODO',
    },
    priority: {
      type: String,
      enum: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
      default: 'MEDIUM',
    },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dueDate: { type: Date, default: null },
    estimateHours: { type: Number, default: null },
    loggedHours: { type: Number, default: 0 },
    blockedReason: { type: String, default: null },
    clientVisible: { type: Boolean, default: true },
    labels: { type: [String], default: [] },
    reminderSentAt: { type: Date, default: null },
    overdueNotified: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: true,
  }
);

taskSchema.index({ projectId: 1, number: 1 }, { unique: true });
taskSchema.index({ orgId: 1, key: 1 }, { unique: true });
taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeId: 1, status: 1 });
taskSchema.index({ dueDate: 1, status: 1 });

export const Task: Model<TaskDocument> =
  mongoose.models.Task || mongoose.model<TaskDocument>('Task', taskSchema);
