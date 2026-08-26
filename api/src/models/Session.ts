import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './schemaOptions';

export interface ISession {
  id: string;
  userId: any;
  orgId: any;
  refreshTokenHash: string;
  generation: number;
  userAgent?: string | null;
  ipAddress?: string | null;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  revokedReason?: string | null;
  createdAt: Date;
}

export type SessionDocument = Document & ISession;

const sessionSchema = new Schema<SessionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    refreshTokenHash: { type: String, required: true },
    generation: { type: Number, default: 1 },
    userAgent: { type: String, default: null },
    ipAddress: { type: String, default: null },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null, index: true },
    revokedReason: { type: String, default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

sessionSchema.index({ userId: 1, revokedAt: 1 });

export const Session: Model<SessionDocument> =
  mongoose.models.Session || mongoose.model<SessionDocument>('Session', sessionSchema);
