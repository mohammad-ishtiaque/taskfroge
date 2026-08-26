import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './schemaOptions';

export interface IWorkspace {
  id: string;
  orgId: any;
  slug: string;
  name: string;
  clientName: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
}

export type WorkspaceDocument = Document & IWorkspace;

const workspaceSchema = new Schema<WorkspaceDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    clientName: { type: String, required: true },
    archivedAt: { type: Date, default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: true,
  }
);

workspaceSchema.index({ orgId: 1, slug: 1 }, { unique: true });

export const Workspace: Model<WorkspaceDocument> =
  mongoose.models.Workspace || mongoose.model<WorkspaceDocument>('Workspace', workspaceSchema);
