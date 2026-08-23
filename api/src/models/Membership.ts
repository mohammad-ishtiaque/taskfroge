import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions, Role, MemberStatus } from './index';

export interface IMembership {
  id: string;
  orgId: any;
  userId: any;
  role: Role;
  status: MemberStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type MembershipDocument = Document & IMembership;

const membershipSchema = new Schema<MembershipDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: {
      type: String,
      enum: ['CLIENT', 'PROJECT_MANAGER', 'DEVELOPER'],
      required: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
    },
  },
  {
    ...defaultSchemaOptions,
    timestamps: true,
  }
);

membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ orgId: 1, role: 1 });

export const Membership: Model<MembershipDocument> =
  mongoose.models.Membership || mongoose.model<MembershipDocument>('Membership', membershipSchema);
