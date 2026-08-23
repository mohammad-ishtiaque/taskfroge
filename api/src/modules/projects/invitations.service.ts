import { env } from '../../config/env';
import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { hashPassword } from '../../lib/password';
import { withTransaction } from '../../lib/db';
import { hashToken, randomToken } from '../../lib/tokens';
import { queueEmail } from '../../lib/email';
import type { AuthContext } from '../../middleware/authenticate';
import { invitationEmail } from './invitation.emails';
import {
  Project,
  User,
  ProjectMember,
  Invitation,
  Membership,
  OrganizationDocument,
  UserDocument,
  ProjectDocument,
  Role,
} from '../../models';

/** Long enough for someone to come back from a week away. */
const INVITE_TTL_DAYS = 7;

export type InviteOutcome =
  | { outcome: 'added'; email: string; name: string }
  | { outcome: 'invited'; email: string; role: Role; expiresAt: Date };

export interface InvitationPreview {
  email: string;
  role: Role;
  projectName: string;
  organizationName: string;
  invitedByName: string;
  hasAccount: boolean;
}

export async function invite(
  auth: AuthContext,
  projectId: string,
  input: { email: string; role: Role },
): Promise<InviteOutcome> {
  const project = await Project.findOne({ _id: projectId, orgId: auth.orgId })
    .populate<{ orgId: OrganizationDocument }>('orgId', 'name');

  if (!project || !project.orgId) throw AppError.notFound('Project');

  const existing = await User.findOne({ email: input.email });

  let isProjectMember = false;
  let isOrgMemberActive = false;

  if (existing) {
    const memberDoc = await ProjectMember.findOne({ projectId, userId: existing.id });
    isProjectMember = Boolean(memberDoc);

    const membershipDoc = await Membership.findOne({ orgId: auth.orgId, userId: existing.id });
    isOrgMemberActive = membershipDoc?.status === 'ACTIVE';
  }

  if (isProjectMember) {
    throw AppError.conflict('That person is already on this project');
  }

  const alreadyInWorkspace = existing?.isActive && isOrgMemberActive;

  if (alreadyInWorkspace) {
    await ProjectMember.create({ projectId, userId: existing.id });
    await Invitation.deleteMany({ projectId, email: input.email });

    logger.info(
      { projectId, userId: existing.id, addedBy: auth.userId },
      'Existing workspace member added to project directly',
    );

    return { outcome: 'added', email: input.email, name: existing.name };
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  await Invitation.findOneAndUpdate(
    { projectId, email: input.email },
    {
      orgId: auth.orgId,
      projectId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: auth.userId,
      expiresAt,
      acceptedAt: null,
      revokedAt: null,
    },
    { upsert: true, new: true }
  );

  const inviter = await User.findById(auth.userId).select('name locale');

  queueEmail(
    invitationEmail({
      to: input.email,
      inviterName: inviter?.name ?? 'Someone',
      organizationName: project.orgId.name,
      projectName: project.name,
      acceptUrl: `${env.WEB_ORIGIN}/accept-invite?token=${token}`,
      locale: inviter?.locale ?? 'en',
      hasAccount: Boolean(existing),
    }),
  );

  logger.info(
    { projectId, email: input.email, role: input.role, invitedBy: auth.userId },
    'Invitation sent',
  );

  return { outcome: 'invited', email: input.email, role: input.role, expiresAt };
}

export async function revokeInvitation(auth: AuthContext, invitationId: string): Promise<void> {
  const result = await Invitation.updateOne(
    { _id: invitationId, orgId: auth.orgId, acceptedAt: null },
    { revokedAt: new Date() }
  );

  if (result.modifiedCount === 0) throw AppError.notFound('Invitation');
}

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await findUsableInvitation(token);

  const user = await User.findOne({ email: invitation.email }).select('id');

  const project = invitation.projectId as unknown as ProjectDocument & { orgId: OrganizationDocument };
  const inviter = invitation.invitedById as unknown as UserDocument;

  return {
    email: invitation.email,
    role: invitation.role,
    projectName: project.name,
    organizationName: project.orgId.name,
    invitedByName: inviter.name,
    hasAccount: Boolean(user),
  };
}

export async function acceptInvitation(
  token: string,
  input: { name?: string; password?: string },
): Promise<{ userId: string; orgId: string; projectId: string; isNewAccount: boolean }> {
  const invitation = await findUsableInvitation(token);

  const existing: any = await User.findOne({ email: invitation.email });

  if (existing && !existing.isActive) {
    throw AppError.unauthenticated('This account has been deactivated', ErrorCode.ACCOUNT_INACTIVE);
  }

  if (!existing) {
    if (!input.password || !input.name) {
      throw AppError.validation('Choose a name and password to finish setting up your account', {
        issues: {
          ...(input.name ? {} : { name: ['Required'] }),
          ...(input.password ? {} : { password: ['Required'] }),
        },
      });
    }
    if (input.password.length < 12) {
      throw AppError.validation('Password is too short', {
        issues: { password: ['Use at least 12 characters'] },
      });
    }
  }

  const passwordHash = input.password ? await hashPassword(input.password) : null;

  const result = await withTransaction(async (session) => {
    let targetUser: any = existing;
    if (!targetUser) {
      const [newDoc] = await User.create(
        [
          {
            email: invitation.email,
            name: input.name!.trim(),
            passwordHash: passwordHash!,
          },
        ],
        { session }
      );
      targetUser = newDoc;
    }

    if (!targetUser) throw AppError.internal('Failed to create user for invitation');

    await Membership.findOneAndUpdate(
      { orgId: invitation.orgId, userId: targetUser.id },
      { $setOnInsert: { orgId: invitation.orgId, userId: targetUser.id, role: invitation.role } },
      { upsert: true, session }
    );

    await ProjectMember.findOneAndUpdate(
      { projectId: invitation.projectId, userId: targetUser.id },
      { $setOnInsert: { projectId: invitation.projectId, userId: targetUser.id } },
      { upsert: true, session }
    );

    await Invitation.updateOne(
      { _id: invitation.id },
      { acceptedAt: new Date() },
      { session }
    );

    await User.updateOne(
      { _id: targetUser.id },
      { lastOrgId: invitation.orgId },
      { session }
    );

    return targetUser;
  });

  if (!result) throw AppError.internal('Failed to accept invitation');

  logger.info(
    {
      userId: result.id,
      projectId: invitation.projectId.toString(),
      isNewAccount: !existing,
    },
    'Invitation accepted',
  );

  return {
    userId: result.id,
    orgId: invitation.orgId.toString(),
    projectId: invitation.projectId.toString(),
    isNewAccount: !existing,
  };
}

async function findUsableInvitation(token: string) {
  const invitation = await Invitation.findOne({ tokenHash: hashToken(token) })
    .populate<{ projectId: ProjectDocument & { orgId: OrganizationDocument } }>({
      path: 'projectId',
      select: 'name status archivedAt orgId',
      populate: { path: 'orgId', select: 'name' },
    })
    .populate<{ invitedById: UserDocument }>('invitedById', 'name');

  const project = invitation?.projectId;

  const usable =
    invitation &&
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt > new Date() &&
    project &&
    project.archivedAt === null;

  if (!usable) {
    throw new AppError({
      code: ErrorCode.INVITATION_INVALID,
      status: 400,
      message: 'This invitation is no longer valid. Ask for a new one.',
    });
  }

  return invitation;
}
