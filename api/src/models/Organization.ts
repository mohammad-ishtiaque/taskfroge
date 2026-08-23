import mongoose, { Schema, Document, Model } from 'mongoose';
import { defaultSchemaOptions } from './index';

export interface IOrganization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationDocument = Document & IOrganization;

const organizationSchema = new Schema<OrganizationDocument>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    timezone: { type: String, default: 'UTC' },
    locale: { type: String, default: 'en' },
  },
  {
    ...defaultSchemaOptions,
    timestamps: true,
  }
);

export const Organization: Model<OrganizationDocument> =
  mongoose.models.Organization || mongoose.model<OrganizationDocument>('Organization', organizationSchema);
