import { Router } from 'express';
import type { Request, Response } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { auditContext } from '../audit/audit.service.js';
import * as tasksService from './tasks.service.js';
import {
  assignTaskSchema,
  changeTaskStatusSchema,
  createCommentSchema,
  createTaskSchema,
  listTasksQuerySchema,
  taskIdParamsSchema,
  updateTaskSchema,
  type ChangeTaskStatusInput,
  type CreateCommentInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type UpdateTaskInput,
} from './tasks.schemas.js';

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

function actor(req: Request): tasksService.Actor {
  return { id: req.user!.id, role: req.user!.role };
}

tasksRouter.get(
  '/',
  requirePermission(PERMISSIONS.TASK_READ),
  validate({ query: listTasksQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await tasksService.listTasks(
      req.query as unknown as ListTasksQuery,
      actor(req),
    );
    sendPaginated(res, result.items, result.meta);
  }),
);

tasksRouter.get(
  '/summary',
  requirePermission(PERMISSIONS.TASK_READ),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await tasksService.getTaskSummary(actor(req)));
  }),
);

tasksRouter.post(
  '/',
  requirePermission(PERMISSIONS.TASK_WRITE),
  validate({ body: createTaskSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const task = await tasksService.createTask(
      req.body as CreateTaskInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, task, 201);
  }),
);

tasksRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.TASK_READ),
  validate({ params: taskIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await tasksService.getTask(req.params.id as string, actor(req)));
  }),
);

tasksRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.TASK_WRITE),
  validate({ params: taskIdParamsSchema, body: updateTaskSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const task = await tasksService.updateTask(
      req.params.id as string,
      req.body as UpdateTaskInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, task);
  }),
);

tasksRouter.post(
  '/:id/status',
  requirePermission(PERMISSIONS.TASK_WRITE),
  validate({ params: taskIdParamsSchema, body: changeTaskStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const task = await tasksService.changeTaskStatus(
      req.params.id as string,
      req.body as ChangeTaskStatusInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, task);
  }),
);

tasksRouter.post(
  '/:id/assign',
  requirePermission(PERMISSIONS.TASK_ASSIGN),
  validate({ params: taskIdParamsSchema, body: assignTaskSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { assigneeId } = req.body as { assigneeId: string | null };
    const task = await tasksService.assignTask(
      req.params.id as string,
      assigneeId,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, task);
  }),
);

tasksRouter.get(
  '/:id/comments',
  requirePermission(PERMISSIONS.TASK_READ),
  validate({ params: taskIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await tasksService.listComments(req.params.id as string, actor(req)));
  }),
);

tasksRouter.post(
  '/:id/comments',
  requirePermission(PERMISSIONS.TASK_WRITE),
  validate({ params: taskIdParamsSchema, body: createCommentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const comment = await tasksService.addComment(
      req.params.id as string,
      req.body as CreateCommentInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, comment, 201);
  }),
);

tasksRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.TASK_DELETE),
  validate({ params: taskIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await tasksService.deleteTask(req.params.id as string, actor(req), auditContext(req));
    sendNoContent(res);
  }),
);
