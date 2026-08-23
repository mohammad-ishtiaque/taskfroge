import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions, VisibilityPreset } from './index';

export interface IProjectVisibility {
  projectId: any;
  preset: VisibilityPreset;
  showBoard: boolean;
  showAssignees: boolean;
  showDueDates: boolean;
  showTimeTracking: boolean;
  showBlockedReasons: boolean;
  showAttachments: boolean;
  updatedById?: any;
  updatedAt: Date;
}

export type ProjectVisibilityDocument = Document & IProjectVisibility;

const projectVisibilitySchema = new Schema<ProjectVisibilityDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    preset: {
      type: String,
      enum: ['OPEN', 'SUMMARY', 'CUSTOM'],
      default: 'OPEN',
    },
    showBoard: { type: Boolean, default: true },
    showAssignees: { type: Boolean, default: true },
    showDueDates: { type: Boolean, default: true },
    showTimeTracking: { type: Boolean, default: false },
    showBlockedReasons: { type: Boolean, default: true },
    showAttachments: { type: Boolean, default: true },
    updatedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: false, updatedAt: true },
  }
);

export const ProjectVisibility: Model<ProjectVisibilityDocument> =
  mongoose.models.ProjectVisibility ||
  mongoose.model<ProjectVisibilityDocument>('ProjectVisibility', projectVisibilitySchema);
