import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './index';

export interface IEmailVerification {
  id: string;
  userId: any;
  email: string;
  tokenHash: string;
  otpHash: string;
  challengeHash: string;
  attempts: number;
  lastSentAt: Date;
  sendCount: number;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}

export type EmailVerificationDocument = Document & IEmailVerification;

const emailVerificationSchema = new Schema<EmailVerificationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    otpHash: { type: String, required: true },
    challengeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    sendCount: { type: Number, default: 1 },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null, index: true },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

emailVerificationSchema.index({ userId: 1, usedAt: 1 });

export const EmailVerification: Model<EmailVerificationDocument> =
  mongoose.models.EmailVerification ||
  mongoose.model<EmailVerificationDocument>('EmailVerification', emailVerificationSchema);
