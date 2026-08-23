import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions, Role } from './index';

export interface IInvitation {
  id: string;
  orgId: any;
  projectId: any;
  email: string;
  role: Role;
  tokenHash: string;
  invitedById: any;
  expiresAt: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt: Date;
}

export type InvitationDocument = Document & IInvitation;

const invitationSchema = new Schema<InvitationDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    email: { type: String, required: true },
    role: {
      type: String,
      enum: ['CLIENT', 'PROJECT_MANAGER', 'DEVELOPER'],
      required: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    invitedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

invitationSchema.index({ projectId: 1, email: 1 }, { unique: true });
invitationSchema.index({ orgId: 1, acceptedAt: 1 });

export const Invitation: Model<InvitationDocument> =
  mongoose.models.Invitation || mongoose.model<InvitationDocument>('Invitation', invitationSchema);
