import { Router, type NextFunction, type Request, type Response } from 'express';

import { sendSuccess } from '../../lib/response';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as tasks from './tasks.service';
import * as comments from '../comments/comments.service';
import * as activity from '../activity/activity.service';
import {
  createCommentSchema,
  createTaskSchema,
  listTasksSchema,
  updateStatusSchema,
  updateTaskSchema,
  type CreateTaskBody,
  type ListTasksQuery,
  type UpdateStatusBody,
  type UpdateTaskBody,
} from './task.schema';

/** Mounted at /api/v1/tasks. */
export const tasksRouter = Router();
/** Mounted at /api/v1/comments. */
export const commentsRouter = Router();
/** Merged into the projects router, which already owns /api/v1/projects. */
export const projectTasksRouter = Router({ mergeParams: true });

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

/**
 * Every route needs a signed-in user, and none of them carry a role gate.
 *
 * That is deliberate and differs from the projects router. Task permissions are
 * not "may this role ever do this" — they are "may this person do this to *this*
 * task", which depends on who it is assigned to. A middleware gate cannot see
 * the row, so a coarse gate here would either be too permissive to matter or
 * would duplicate the real check badly. The service does all of it.
 */
tasksRouter.use(authenticate);
commentsRouter.use(authenticate);
projectTasksRouter.use(authenticate);

/* ── Project-scoped ─────────────────────────────────────────────────────── */

projectTasksRouter.get(
  '/:key/tasks',
  validate(listTasksSchema, 'query'),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const project = await tasks.requireProject(auth, req.params.key!);
    const filters = req.query as unknown as ListTasksQuery;

    sendSuccess(res, await tasks.listTasks(auth, project.id, filters));
  }),
);

projectTasksRouter.post(
  '/:key/tasks',
  validate(createTaskSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const task = await tasks.createTask(auth, req.params.key!, req.body as CreateTaskBody);
    sendSuccess(res, task, 201);
  }),
);

projectTasksRouter.get(
  '/:key/activity',
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const project = await tasks.requireProject(auth, req.params.key!);
    sendSuccess(res, await activity.listActivity(auth, { projectId: project.id }));
  }),
);

/* ── Task-scoped ────────────────────────────────────────────────────────── */

tasksRouter.get(
  '/mine',
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    sendSuccess(res, await tasks.listMyTasks(auth, workspaceId));
  }),
);

tasksRouter.get(
  '/:key',
  handle(async (req, res) => {
    sendSuccess(res, await tasks.getTaskByKey(requireAuth(req), req.params.key!));
  }),
);

tasksRouter.patch(
  '/:key',
  validate(updateTaskSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    sendSuccess(res, await tasks.updateTask(auth, req.params.key!, req.body as UpdateTaskBody));
  }),
);

/**
 * Status is its own endpoint rather than a field on PATCH /tasks/:key.
 *
 * It has different permissions (a developer may move their own task but not
 * edit its due date), different validation (BLOCKED requires a reason) and
 * different side effects. Folding it into the general patch would mean one
 * handler with two unrelated shapes of rule inside it.
 */
tasksRouter.patch(
  '/:key/status',
  validate(updateStatusSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const task = await tasks.updateTaskStatus(auth, req.params.key!, req.body as UpdateStatusBody);
    sendSuccess(res, task);
  }),
);

tasksRouter.delete(
  '/:key',
  handle(async (req, res) => {
    await tasks.archiveTask(requireAuth(req), req.params.key!);
    sendSuccess(res, { archived: true });
  }),
);

tasksRouter.get(
  '/:key/comments',
  handle(async (req, res) => {
    sendSuccess(res, await comments.listComments(requireAuth(req), req.params.key!));
  }),
);

tasksRouter.post(
  '/:key/comments',
  validate(createCommentSchema),
  handle(async (req, res) => {
    const auth = requireAuth(req);
    const comment = await comments.addComment(auth, req.params.key!, req.body as { body: string; isInternal?: boolean });
    sendSuccess(res, comment, 201);
  }),
);

commentsRouter.delete(
  '/:id',
  handle(async (req, res) => {
    await comments.deleteComment(requireAuth(req), req.params.id!);
    sendSuccess(res, { deleted: true });
  }),
);
