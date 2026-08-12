import { Prisma, type Role } from '@prisma/client';
import { env } from '../../config/env';
import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { hashToken, randomToken } from '../../lib/tokens';
import { sendEmail } from '../../lib/email';
import type { AuthContext } from '../../middleware/authenticate';
import { invitationEmail } from './invitation.emails';

/** Long enough for someone to come back from a week away. */
const INVITE_TTL_DAYS = 7;

/**
 * What actually happened when you "invited" someone.
 *
 * `added` means they were already in the workspace and are now on the project —
 * no email, nothing to accept. `invited` means a link was sent because they
 * need to create an account or join the organisation first.
 */
export type InviteOutcome =
  | { outcome: 'added'; email: string; name: string }
  | { outcome: 'invited'; email: string; role: Role; expiresAt: Date };

export interface InvitationPreview {
  email: string;
  role: Role;
  projectName: string;
  organizationName: string;
  invitedByName: string;
  /** True when this email already has an account — the UI asks them to sign in. */
  hasAccount: boolean;
}

/**
 * Invites someone to a project.
 *
 * A second invitation to the same email supersedes the first: the old token is
 * overwritten, so only the newest link works. Two live links in one inbox is
 * confusing and doubles the window an intercepted email is useful.
 */
export async function invite(
  auth: AuthContext,
  projectId: string,
  input: { email: string; role: Role },
): Promise<InviteOutcome> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: auth.orgId },
    select: { id: true, name: true, org: { select: { name: true } } },
  });

  if (!project) throw AppError.notFound('Project');

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      name: true,
      isActive: true,
      projectMembers: { where: { projectId }, select: { id: true } },
      memberships: { where: { orgId: auth.orgId }, select: { status: true } },
    },
  });

  // Already on the project? Inviting them again would send a link that does
  // nothing, and they would reasonably think it was broken.
  if (existing?.projectMembers.length) {
    throw AppError.conflict('That person is already on this project');
  }

  // Already in the workspace? Then there is nothing to accept — they can see
  // the project the moment they are a member. Sending a link they must click
  // to gain access they could already have is pure friction, and it is exactly
  // how a "pending invitation" ends up sitting there forever.
  const alreadyInWorkspace =
    existing?.isActive && existing.memberships[0]?.status === 'ACTIVE';

  if (alreadyInWorkspace) {
    await prisma.projectMember.create({ data: { projectId, userId: existing.id } });

    // Any earlier invitation to this address is now pointless.
    await prisma.invitation.deleteMany({ where: { projectId, email: input.email } });

    logger.info(
      { projectId, userId: existing.id, addedBy: auth.userId },
      'Existing workspace member added to project directly',
    );

    return { outcome: 'added', email: input.email, name: existing.name };
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  await prisma.invitation.upsert({
    where: { projectId_email: { projectId, email: input.email } },
    update: {
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: auth.userId,
      expiresAt,
      acceptedAt: null,
      revokedAt: null,
    },
    create: {
      orgId: auth.orgId,
      projectId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: auth.userId,
      expiresAt,
    },
  });

  const inviter = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { name: true, locale: true },
  });

  await sendEmail(
    invitationEmail({
      to: input.email,
      inviterName: inviter?.name ?? 'Someone',
      organizationName: project.org.name,
      projectName: project.name,
      acceptUrl: `${env.WEB_ORIGIN}/accept-invite?token=${token}`,
      // The invitee has no account yet, so no language preference exists.
      // Falling back to the inviter's is the best guess available.
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
  const result = await prisma.invitation.updateMany({
    where: { id: invitationId, orgId: auth.orgId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) throw AppError.notFound('Invitation');
}

/**
 * What the accept page shows before anyone types anything.
 *
 * Deliberately reveals only the project and organisation names plus whether an
 * account exists — enough to orient someone, not enough to be useful to
 * whoever might have intercepted the link.
 */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await findUsableInvitation(token);

  const user = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  return {
    email: invitation.email,
    role: invitation.role,
    projectName: invitation.project.name,
    organizationName: invitation.project.org.name,
    invitedByName: invitation.invitedBy.name,
    hasAccount: Boolean(user),
  };
}

/**
 * Accepts an invitation.
 *
 * Two paths, both ending in the same place:
 *   • no account yet  → create the user, the org membership and the project
 *                       membership, using the password they just chose
 *   • already a user  → add the org membership if missing, plus the project
 *                       membership. Their existing role is left alone
 *
 * That last point matters: an invitation must not be able to change someone's
 * organisation role. If a developer is invited to a project as a CLIENT, they
 * join the project — they do not get demoted.
 */
export async function acceptInvitation(
  token: string,
  input: { name?: string; password?: string },
): Promise<{ userId: string; orgId: string; projectId: string; isNewAccount: boolean }> {
  const invitation = await findUsableInvitation(token);

  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, isActive: true },
  });

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

  const result = await prisma.$transaction(async (tx) => {
    const user = existing
      ? existing
      : await tx.user.create({
          data: {
            email: invitation.email,
            name: input.name!.trim(),
            passwordHash: passwordHash!,
          },
          select: { id: true, isActive: true },
        });

    // Org membership: create with the invited role, or leave an existing one
    // untouched. An invitation grants access; it never re-grades someone.
    await tx.membership.upsert({
      where: { orgId_userId: { orgId: invitation.orgId, userId: user.id } },
      update: {},
      create: { orgId: invitation.orgId, userId: user.id, role: invitation.role },
    });

    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
      update: {},
      create: { projectId: invitation.projectId, userId: user.id },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    return user;
  });

  logger.info(
    {
      userId: result.id,
      projectId: invitation.projectId,
      isNewAccount: !existing,
    },
    'Invitation accepted',
  );

  return {
    userId: result.id,
    orgId: invitation.orgId,
    projectId: invitation.projectId,
    isNewAccount: !existing,
  };
}

// ── internals ───────────────────────────────────────────────────────────────

/**
 * One lookup, one error message.
 *
 * Expired, revoked, already used and never-existed all return the same thing.
 * Distinguishing them would let someone with a guessed token learn whether it
 * was ever real.
 */
async function findUsableInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      // `archivedAt` is read by the usability check below. Adding a field to
      // that check without adding it here silently makes it undefined.
      project: {
        select: { id: true, name: true, status: true, archivedAt: true, org: { select: { name: true } } },
      },
      invitedBy: { select: { name: true } },
    },
  });

  const usable =
    invitation &&
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt > new Date() &&
    // Not archived — deliberately not a status comparison. A project can be
    // PLANNING, ACTIVE or ON_HOLD and still be one you invite people into.
    invitation.project.archivedAt === null;

  if (!usable) {
    throw new AppError({
      code: ErrorCode.INVITATION_INVALID,
      status: 400,
      message: 'This invitation is no longer valid. Ask for a new one.',
    });
  }

  return invitation;
}

export type { Prisma };
