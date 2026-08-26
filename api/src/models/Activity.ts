import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions, ActivityKind } from './schemaOptions';

export interface IActivity {
  id: string;
  orgId: any;
  projectId: any;
  taskId?: any;
  actorId: any;
  kind: ActivityKind;
  detail: Record<string, any>;
  clientVisible: boolean;
  createdAt: Date;
}

export type ActivityDocument = Document & IActivity;

const activitySchema = new Schema<ActivityDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: {
      type: String,
      enum: [
        'TASK_CREATED',
        'STATUS_CHANGED',
        'ASSIGNED',
        'COMMENTED',
        'DUE_DATE_CHANGED',
        'BLOCKED',
        'UNBLOCKED',
        'VISIBILITY_CHANGED',
      ],
      required: true,
    },
    detail: { type: Schema.Types.Mixed, default: {} },
    clientVisible: { type: Boolean, default: true },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

activitySchema.index({ projectId: 1, createdAt: 1 });

export const Activity: Model<ActivityDocument> =
  mongoose.models.Activity || mongoose.model<ActivityDocument>('Activity', activitySchema);
