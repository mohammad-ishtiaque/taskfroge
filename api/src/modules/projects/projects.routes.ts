import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendSuccess } from '../../lib/response';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as invitations from './invitations.service';
import * as projects from './projects.service';
import { getProjectStats } from '../dashboard/dashboard.service';
import { requireProject } from '../tasks/tasks.service';
import {
  addMemberSchema,
  createProjectSchema,
  inviteSchema,
  updateProjectSchema,
  visibilitySchema,
  type CreateProjectInput,
  type InviteInput,
  type UpdateProjectInput,
  type VisibilityInput,
} from './project.schema';

export const projectsRouter = Router();

/** Wraps an async handler so a rejection reaches the error middleware. */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

/**
 * Everything here requires a signed-in user. Writes additionally require
 * PROJECT_MANAGER — the first real use of the role gate, and the reason it now
 * has tests of its own.
 *
 * The gate is coarse: "may a project manager ever do this?". Whether *this*
 * project belongs to their organisation is checked in the service, which is the
 * only layer that has the row.
 */
projectsRouter.use(authenticate);

const managersOnly = authorize('PROJECT_MANAGER');

// ── Projects ────────────────────────────────────────────────────────────────

projectsRouter.get(
  '/',
  handle(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;

    sendSuccess(
      res,
      await projects.listProjects(
        requireAuth(req),
        {
          workspaceId: q.workspaceId,
          status: q.status,
          priority: q.priority,
          search: q.search,
        },
        q.includeArchived === 'true',
      ),
    );
  }),
);

projectsRouter.post(
  '/',
  managersOnly,
  validate(createProjectSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as CreateProjectInput;

    const project = await projects.createProject(auth, body);

    // Invitations sent during creation are best-effort: the project exists
    // either way, and a failed invite should not roll back a created project.
    // Each result is reported so the UI can show what actually went out.
    const invited = await Promise.allSettled(
      body.invites.map((entry) => invitations.invite(auth, project.id, entry as InviteInput)),
    );

    sendSuccess(
      res,
      {
        project,
        invitations: invited.map((result, index) => ({
          email: body.invites[index]!.email,
          sent: result.status === 'fulfilled',
          outcome: result.status === 'fulfilled' ? result.value.outcome : 'failed',
        })),
      },
      201,
    );
  }),
);

projectsRouter.get(
  '/:idOrKey',
  handle(async (req, res) => {
    sendSuccess(res, await projects.getProject(requireAuth(req), req.params.idOrKey!));
  }),
);

projectsRouter.patch(
  '/:idOrKey',
  managersOnly,
  validate(updateProjectSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    sendSuccess(res, await projects.updateProject(auth, id, req.body as UpdateProjectInput));
  }),
);

projectsRouter.post(
  '/:idOrKey/archive',
  managersOnly,
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    sendSuccess(res, await projects.archiveProject(auth, id));
  }),
);

projectsRouter.post(
  '/:idOrKey/restore',
  managersOnly,
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    sendSuccess(res, await projects.restoreProject(auth, id));
  }),
);

// ── Client visibility ───────────────────────────────────────────────────────

projectsRouter.put(
  '/:idOrKey/visibility',
  managersOnly,
  validate(visibilitySchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    sendSuccess(res, await projects.updateVisibility(auth, id, req.body as VisibilityInput));
  }),
);

// ── Members ─────────────────────────────────────────────────────────────────

projectsRouter.get(
  '/:idOrKey/assignable',
  managersOnly,
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    sendSuccess(res, await projects.listAssignableUsers(auth, id));
  }),
);

projectsRouter.get(
  '/:idOrKey/members',
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const project = await projects.getProject(auth, req.params.idOrKey!);
    sendSuccess(res, await projects.listProjectMembers(auth, project.id));
  }),
);

projectsRouter.post(
  '/:idOrKey/members',
  managersOnly,
  validate(addMemberSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    const { userId } = req.body as { userId: string };
    sendSuccess(res, await projects.addMember(auth, id, userId), 201);
  }),
);

projectsRouter.delete(
  '/:idOrKey/members/:userId',
  managersOnly,
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    await projects.removeMember(auth, id, req.params.userId!);
    sendSuccess(res, { removed: true });
  }),
);

// ── Invitations ─────────────────────────────────────────────────────────────

projectsRouter.post(
  '/:idOrKey/invitations',
  managersOnly,
  validate(inviteSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const id = await projects.resolveProjectId(auth, req.params.idOrKey!);
    sendSuccess(res, await invitations.invite(auth, id, req.body as InviteInput), 201);
  }),
);

projectsRouter.delete(
  '/invitations/:invitationId',
  managersOnly,
  handle(async (req, res) => {
    await invitations.revokeInvitation(requireAuth(req), req.params.invitationId!);
    sendSuccess(res, { revoked: true });
  }),
);

/**
 * Stats for the analytics tab.
 *
 * Counted in the database with groupBy rather than by loading every task and
 * counting in JavaScript — the numbers are the whole payload, and shipping a
 * thousand rows to produce five integers is the wrong shape.
 *
 * A client's counts are computed over visible tasks only, so the completion
 * percentage they see is internally consistent with the list they can open.
 */
projectsRouter.get(
  '/:key/stats',
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const project = await requireProject(auth, req.params.key!);
    sendSuccess(res, await getProjectStats(auth, project.id));
  }),
);
