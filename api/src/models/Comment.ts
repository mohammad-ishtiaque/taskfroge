import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './schemaOptions';

export interface IComment {
  id: string;
  orgId: any;
  taskId: any;
  authorId: any;
  body: string;
  isInternal: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export type CommentDocument = Document & IComment;

const commentSchema = new Schema<CommentDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    isInternal: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: true,
  }
);

commentSchema.index({ taskId: 1, createdAt: 1 });

export const Comment: Model<CommentDocument> =
  mongoose.models.Comment || mongoose.model<CommentDocument>('Comment', commentSchema);
