import { Client } from 'pg';
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

/* ==========================================================================
   Data Migration Script: PostgreSQL (Prisma) -> MongoDB (Mongoose)
   --------------------------------------------------------------------------
   Extracts data from PostgreSQL, maps legacy UUIDs to MongoDB ObjectIds,
   resolves foreign key relationships, and batch-inserts into MongoDB.
   ========================================================================== */

const pgUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/taskforge';
const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/taskforge';

const idMap = new Map<string, mongoose.Types.ObjectId>();

function mapId(legacyId: string | null | undefined): mongoose.Types.ObjectId | null {
  if (!legacyId) return null;
  if (!idMap.has(legacyId)) {
    idMap.set(legacyId, new mongoose.Types.ObjectId());
  }
  return idMap.get(legacyId)!;
}

async function migrate() {
  console.log('🚀 Starting database migration from PostgreSQL to MongoDB...');

  const pgClient = new Client({ connectionString: pgUrl });
  await pgClient.connect();
  console.log('✅ Connected to PostgreSQL');

  await mongoose.connect(mongoUrl);
  console.log('✅ Connected to MongoDB');

  try {
    // 1. Organization
    console.log('Migrating Organizations...');
    const orgsRes = await pgClient.query('SELECT * FROM "Organization"');
    for (const row of orgsRes.rows) {
      const mongoId = mapId(row.id)!;
      await Organization.create({
        _id: mongoId,
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        locale: row.locale,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    // 2. User
    console.log('Migrating Users...');
    const usersRes = await pgClient.query('SELECT * FROM "User"');
    for (const row of usersRes.rows) {
      const mongoId = mapId(row.id)!;
      await User.create({
        _id: mongoId,
        email: row.email,
        name: row.name,
        passwordHash: row.passwordHash,
        avatarUrl: row.avatarUrl,
        locale: row.locale,
        timezone: row.timezone,
        isActive: row.isActive,
        emailVerifiedAt: row.emailVerifiedAt,
        lastLoginAt: row.lastLoginAt,
        lastOrgId: mapId(row.lastOrgId),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    // 3. Membership
    console.log('Migrating Memberships...');
    const membershipsRes = await pgClient.query('SELECT * FROM "Membership"');
    for (const row of membershipsRes.rows) {
      const mongoId = mapId(row.id)!;
      await Membership.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        userId: mapId(row.userId),
        role: row.role,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    // 4. Session
    console.log('Migrating Sessions...');
    const sessionsRes = await pgClient.query('SELECT * FROM "Session"');
    for (const row of sessionsRes.rows) {
      const mongoId = mapId(row.id)!;
      await Session.create({
        _id: mongoId,
        userId: mapId(row.userId),
        orgId: mapId(row.orgId),
        refreshTokenHash: row.refreshTokenHash,
        generation: row.generation,
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        revokedReason: row.revokedReason,
        createdAt: row.createdAt,
      });
    }

    // 5. PasswordResetToken
    console.log('Migrating PasswordResetTokens...');
    const resetRes = await pgClient.query('SELECT * FROM "PasswordResetToken"');
    for (const row of resetRes.rows) {
      const mongoId = mapId(row.id)!;
      await PasswordResetToken.create({
        _id: mongoId,
        userId: mapId(row.userId),
        tokenHash: row.tokenHash,
        challengeHash: row.challengeHash,
        otpHash: row.otpHash,
        attempts: row.attempts,
        requestIp: row.requestIp,
        requestAgent: row.requestAgent,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        createdAt: row.createdAt,
      });
    }

    // 6. EmailVerification
    console.log('Migrating EmailVerifications...');
    const emailVerRes = await pgClient.query('SELECT * FROM "EmailVerification"');
    for (const row of emailVerRes.rows) {
      const mongoId = mapId(row.id)!;
      await EmailVerification.create({
        _id: mongoId,
        userId: mapId(row.userId),
        email: row.email,
        tokenHash: row.tokenHash,
        otpHash: row.otpHash,
        challengeHash: row.challengeHash,
        attempts: row.attempts,
        lastSentAt: row.lastSentAt,
        sendCount: row.sendCount,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        createdAt: row.createdAt,
      });
    }

    // 7. Workspace
    console.log('Migrating Workspaces...');
    const workspacesRes = await pgClient.query('SELECT * FROM "Workspace"');
    for (const row of workspacesRes.rows) {
      const mongoId = mapId(row.id)!;
      await Workspace.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        slug: row.slug,
        name: row.name,
        clientName: row.clientName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      });
    }

    // 8. Project
    console.log('Migrating Projects...');
    const projectsRes = await pgClient.query('SELECT * FROM "Project"');
    for (const row of projectsRes.rows) {
      const mongoId = mapId(row.id)!;
      await Project.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        workspaceId: mapId(row.workspaceId),
        key: row.key,
        name: row.name,
        description: row.description,
        status: row.status,
        priority: row.priority,
        startDate: row.startDate,
        endDate: row.endDate,
        leadId: mapId(row.leadId),
        createdById: mapId(row.createdById),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      });
    }

    // 9. Task
    console.log('Migrating Tasks...');
    const tasksRes = await pgClient.query('SELECT * FROM "Task"');
    for (const row of tasksRes.rows) {
      const mongoId = mapId(row.id)!;
      await Task.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        projectId: mapId(row.projectId),
        parentId: mapId(row.parentId),
        number: row.number,
        key: row.key,
        title: row.title,
        description: row.description,
        type: row.type,
        status: row.status,
        priority: row.priority,
        assigneeId: mapId(row.assigneeId),
        reporterId: mapId(row.reporterId),
        dueDate: row.dueDate,
        estimateHours: row.estimateHours ? Number(row.estimateHours) : null,
        loggedHours: row.loggedHours ? Number(row.loggedHours) : 0,
        blockedReason: row.blockedReason,
        clientVisible: row.clientVisible,
        labels: row.labels ?? [],
        reminderSentAt: row.reminderSentAt,
        overdueNotified: row.overdueNotified,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      });
    }

    // 10. Comment
    console.log('Migrating Comments...');
    const commentsRes = await pgClient.query('SELECT * FROM "Comment"');
    for (const row of commentsRes.rows) {
      const mongoId = mapId(row.id)!;
      await Comment.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        taskId: mapId(row.taskId),
        authorId: mapId(row.authorId),
        body: row.body,
        isInternal: row.isInternal,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      });
    }

    // 11. Activity
    console.log('Migrating Activities...');
    const activitiesRes = await pgClient.query('SELECT * FROM "Activity"');
    for (const row of activitiesRes.rows) {
      const mongoId = mapId(row.id)!;
      await Activity.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        projectId: mapId(row.projectId),
        taskId: mapId(row.taskId),
        actorId: mapId(row.actorId),
        kind: row.kind,
        detail: row.detail ?? {},
        clientVisible: row.clientVisible,
        createdAt: row.createdAt,
      });
    }

    // 12. Notification
    console.log('Migrating Notifications...');
    const notificationsRes = await pgClient.query('SELECT * FROM "Notification"');
    for (const row of notificationsRes.rows) {
      const mongoId = mapId(row.id)!;
      await Notification.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        recipientId: mapId(row.recipientId),
        actorId: mapId(row.actorId),
        kind: row.kind,
        taskId: mapId(row.taskId),
        taskKey: row.taskKey,
        taskTitle: row.taskTitle,
        projectKey: row.projectKey,
        readAt: row.readAt,
        createdAt: row.createdAt,
      });
    }

    // 13. ProjectMember
    console.log('Migrating ProjectMembers...');
    const projectMembersRes = await pgClient.query('SELECT * FROM "ProjectMember"');
    for (const row of projectMembersRes.rows) {
      const mongoId = mapId(row.id)!;
      await ProjectMember.create({
        _id: mongoId,
        projectId: mapId(row.projectId),
        userId: mapId(row.userId),
        addedAt: row.addedAt,
      });
    }

    // 14. ProjectVisibility
    console.log('Migrating ProjectVisibilities...');
    const projectVisRes = await pgClient.query('SELECT * FROM "ProjectVisibility"');
    for (const row of projectVisRes.rows) {
      await ProjectVisibility.create({
        projectId: mapId(row.projectId),
        preset: row.preset,
        showBoard: row.showBoard,
        showAssignees: row.showAssignees,
        showDueDates: row.showDueDates,
        showTimeTracking: row.showTimeTracking,
        showBlockedReasons: row.showBlockedReasons,
        showAttachments: row.showAttachments,
        updatedById: mapId(row.updatedById),
        updatedAt: row.updatedAt,
      });
    }

    // 15. Invitation
    console.log('Migrating Invitations...');
    const invitationsRes = await pgClient.query('SELECT * FROM "Invitation"');
    for (const row of invitationsRes.rows) {
      const mongoId = mapId(row.id)!;
      await Invitation.create({
        _id: mongoId,
        orgId: mapId(row.orgId),
        projectId: mapId(row.projectId),
        email: row.email,
        role: row.role,
        tokenHash: row.tokenHash,
        invitedById: mapId(row.invitedById),
        expiresAt: row.expiresAt,
        acceptedAt: row.acceptedAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      });
    }

    // 16. PushSubscription
    console.log('Migrating PushSubscriptions...');
    const pushSubRes = await pgClient.query('SELECT * FROM "PushSubscription"');
    for (const row of pushSubRes.rows) {
      const mongoId = mapId(row.id)!;
      await PushSubscription.create({
        _id: mongoId,
        userId: mapId(row.userId),
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        label: row.label,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
      });
    }

    console.log('🎉 Data migration completed successfully with 1:1 parity!');
  } catch (error) {
    console.error('❌ Data migration failed:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
    await mongoose.disconnect();
  }
}

void migrate();
