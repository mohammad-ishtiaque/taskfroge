import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './index';

export interface IPasswordResetToken {
  id: string;
  userId: any;
  tokenHash: string;
  challengeHash: string;
  otpHash?: string | null;
  attempts: number;
  requestIp?: string | null;
  requestAgent?: string | null;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}

export type PasswordResetTokenDocument = Document & IPasswordResetToken;

const passwordResetTokenSchema = new Schema<PasswordResetTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    challengeHash: { type: String, required: true },
    otpHash: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    requestIp: { type: String, default: null },
    requestAgent: { type: String, default: null },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null, index: true },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

passwordResetTokenSchema.index({ userId: 1, usedAt: 1 });

export const PasswordResetToken: Model<PasswordResetTokenDocument> =
  mongoose.models.PasswordResetToken ||
  mongoose.model<PasswordResetTokenDocument>('PasswordResetToken', passwordResetTokenSchema);
