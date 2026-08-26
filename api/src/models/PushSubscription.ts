import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './schemaOptions';

export interface IPushSubscription {
  id: string;
  userId: any;
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export type PushSubscriptionDocument = Document & IPushSubscription;

const pushSubscriptionSchema = new Schema<PushSubscriptionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    label: { type: String, default: null },
    lastSeenAt: { type: Date, default: Date.now },
  },
  {
    ...defaultSchemaOptions,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const PushSubscription: Model<PushSubscriptionDocument> =
  mongoose.models.PushSubscription ||
  mongoose.model<PushSubscriptionDocument>('PushSubscription', pushSubscriptionSchema);
