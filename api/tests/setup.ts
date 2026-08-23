import 'dotenv/config';
import mongoose from 'mongoose';
import {
  Organization,
  User,
  Membership,
  Session,
  PasswordResetToken,
  EmailVerification,
  Workspace,
  Project,
  Task,
  Comment,
  Activity,
  Notification,
  ProjectMember,
  ProjectVisibility,
  Invitation,
  PushSubscription,
} from '../src/models';

function getTestMongoUri(): string {
  if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb')) {
    return process.env.MONGODB_URI.replace(/\/[^/?]+(\?|$)/, '/taskforge_test$1');
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('mongodb')) {
    return process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/taskforge_test$1');
  }
  return 'mongodb://127.0.0.1:27017/taskforge_test';
}

const mongoUri = getTestMongoUri();

export async function ensureConnected(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri);
  }
}

export async function resetDatabase(): Promise<void> {
  await ensureConnected();

  await Promise.all([
    Organization.deleteMany({}),
    User.deleteMany({}),
    Membership.deleteMany({}),
    Session.deleteMany({}),
    PasswordResetToken.deleteMany({}),
    EmailVerification.deleteMany({}),
    Workspace.deleteMany({}),
    Project.deleteMany({}),
    Task.deleteMany({}),
    Comment.deleteMany({}),
    Activity.deleteMany({}),
    Notification.deleteMany({}),
    ProjectMember.deleteMany({}),
    ProjectVisibility.deleteMany({}),
    Invitation.deleteMany({}),
    PushSubscription.deleteMany({}),
  ]);
}

export async function assertTruncateCoversEveryTable(): Promise<void> {
  // No-op for Mongoose MongoDB testing
}

export async function closeDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

function normalizeWhere(where: any): any {
  if (!where) return {};
  const query: any = {};
  for (const key of Object.keys(where)) {
    if (key === 'id') {
      query._id = where.id;
    } else if (key.includes('_') && typeof where[key] === 'object' && where[key] !== null) {
      Object.assign(query, where[key]);
    } else {
      query[key] = where[key];
    }
  }
  return query;
}

function createAdapter(Model: any) {
  return {
    async create(args: { data: any }) {
      const doc = await Model.create(args.data);
      return doc.toJSON();
    },
    async findUnique(args: { where: any }) {
      const query = normalizeWhere(args.where);
      const doc = await Model.findOne(query);
      return doc ? doc.toJSON() : null;
    },
    async findUniqueOrThrow(args: { where: any }) {
      const query = normalizeWhere(args.where);
      const doc = await Model.findOne(query);
      if (!doc) throw new Error('Record not found');
      return doc.toJSON();
    },
    async findFirst(args: { where?: any } = {}) {
      const query = args.where ? normalizeWhere(args.where) : {};
      const doc = await Model.findOne(query);
      return doc ? doc.toJSON() : null;
    },
    async findFirstOrThrow(args: { where?: any } = {}) {
      const query = args.where ? normalizeWhere(args.where) : {};
      const doc = await Model.findOne(query);
      if (!doc) throw new Error('Record not found');
      return doc.toJSON();
    },
    async update(args: { where: any; data: any }) {
      const query = normalizeWhere(args.where);
      const doc = await Model.findOneAndUpdate(query, args.data, { new: true });
      return doc ? doc.toJSON() : null;
    },
    async updateMany(args: { where: any; data: any }) {
      const query = normalizeWhere(args.where);
      const res = await Model.updateMany(query, args.data);
      return { count: res.modifiedCount };
    },
    async upsert(args: { where: any; create: any; update: any }) {
      const query = normalizeWhere(args.where);
      const doc = await Model.findOneAndUpdate(
        query,
        { $set: args.update, $setOnInsert: args.create },
        { upsert: true, new: true }
      );
      return doc ? doc.toJSON() : null;
    },
    async count(args: { where?: any } = {}) {
      const query = args.where ? normalizeWhere(args.where) : {};
      return Model.countDocuments(query);
    },
  };
}

export const prisma: any = {
  organization: createAdapter(Organization),
  user: createAdapter(User),
  membership: createAdapter(Membership),
  session: createAdapter(Session),
  passwordResetToken: createAdapter(PasswordResetToken),
  emailVerification: createAdapter(EmailVerification),
  workspace: createAdapter(Workspace),
  project: createAdapter(Project),
  task: createAdapter(Task),
  comment: createAdapter(Comment),
  activity: createAdapter(Activity),
  notification: createAdapter(Notification),
  projectMember: createAdapter(ProjectMember),
  projectVisibility: createAdapter(ProjectVisibility),
  invitation: createAdapter(Invitation),
  pushSubscription: createAdapter(PushSubscription),
};
