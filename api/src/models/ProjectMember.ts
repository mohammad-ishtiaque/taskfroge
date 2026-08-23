import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './index';

export interface IProjectMember {
  id: string;
  projectId: any;
  userId: any;
  addedAt: Date;
}

export type ProjectMemberDocument = Document & IProjectMember;

const projectMemberSchema = new Schema<ProjectMemberDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    addedAt: { type: Date, default: Date.now },
  },
  {
    ...defaultSchemaOptions,
  }
);

projectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });

export const ProjectMember: Model<ProjectMemberDocument> =
  mongoose.models.ProjectMember ||
  mongoose.model<ProjectMemberDocument>('ProjectMember', projectMemberSchema);
