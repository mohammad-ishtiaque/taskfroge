import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions, ProjectStatus, Priority } from './schemaOptions';

export interface IProject {
  id: string;
  orgId: any;
  workspaceId: any;
  key: string;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  priority: Priority;
  startDate?: Date | null;
  endDate?: Date | null;
  leadId?: any;
  createdById: any;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
}

export type ProjectDocument = Document & IProject;

const projectSchema = new Schema<ProjectDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
      default: 'PLANNING',
    },
    priority: {
      type: String,
      enum: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
      default: 'MEDIUM',
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    leadId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    archivedAt: { type: Date, default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: true,
  }
);

projectSchema.index({ orgId: 1, key: 1 }, { unique: true });
projectSchema.index({ orgId: 1, status: 1 });

export const Project: Model<ProjectDocument> =
  mongoose.models.Project || mongoose.model<ProjectDocument>('Project', projectSchema);
