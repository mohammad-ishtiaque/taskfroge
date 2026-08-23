import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions, NotificationKind } from './index';

export interface INotification {
  id: string;
  orgId: any;
  recipientId: any;
  actorId?: any;
  kind: NotificationKind;
  taskId?: any;
  taskKey: string;
  taskTitle: string;
  projectKey: string;
  readAt?: Date | null;
  createdAt: Date;
}

export type NotificationDocument = Document & INotification;

const notificationSchema = new Schema<NotificationDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    kind: {
      type: String,
      enum: ['ASSIGNED', 'MENTIONED', 'STATUS_CHANGED', 'DUE_SOON', 'OVERDUE', 'COMMENT'],
      required: true,
    },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    taskKey: { type: String, required: true },
    taskTitle: { type: String, required: true },
    projectKey: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

notificationSchema.index({ recipientId: 1, readAt: 1 });

export const Notification: Model<NotificationDocument> =
  mongoose.models.Notification || mongoose.model<NotificationDocument>('Notification', notificationSchema);
