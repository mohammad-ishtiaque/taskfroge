import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './schemaOptions';

export interface IUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  avatarUrl?: string | null;
  locale: string;
  timezone: string;
  isActive: boolean;
  emailVerifiedAt?: Date | null;
  lastLoginAt?: Date | null;
  lastOrgId?: any;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = Document & IUser;

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    locale: { type: String, default: 'en' },
    timezone: { type: String, default: 'UTC' },
    isActive: { type: Boolean, default: true },
    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastOrgId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: true,
  }
);

export const User: Model<UserDocument> =
  mongoose.models.User || mongoose.model<UserDocument>('User', userSchema);
