import { Router } from 'express';
import type { Request, Response } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { auditContext } from '../audit/audit.service.js';
import * as projectsService from './projects.service.js';
import {
  changeProjectStatusSchema,
  createMilestoneSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  memberParamsSchema,
  milestoneIdParamsSchema,
  projectIdParamsSchema,
  projectMemberSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  type ChangeProjectStatusInput,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type ProjectMemberInput,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from './projects.schemas.js';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

/** Every project read is scoped by who is asking. */
function actor(req: Request): projectsService.Actor {
  return { id: req.user!.id, role: req.user!.role };
}

projectsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PROJECT_READ),
  validate({ query: listProjectsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await projectsService.listProjects(
      req.query as unknown as ListProjectsQuery,
      actor(req),
    );
    sendPaginated(res, result.items, result.meta);
  }),
);

projectsRouter.get(
  '/summary',
  requirePermission(PERMISSIONS.PROJECT_READ),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await projectsService.getProjectSummary(actor(req)));
  }),
);

projectsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PROJECT_WRITE),
  validate({ body: createProjectSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const project = await projectsService.createProject(
      req.body as CreateProjectInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, project, 201);
  }),
);

projectsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PROJECT_READ),
  validate({ params: projectIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await projectsService.getProject(req.params.id as string, actor(req)));
  }),
);

projectsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.PROJECT_WRITE),
  validate({ params: projectIdParamsSchema, body: updateProjectSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const project = await projectsService.updateProject(
      req.params.id as string,
      req.body as UpdateProjectInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, project);
  }),
);

projectsRouter.post(
  '/:id/status',
  requirePermission(PERMISSIONS.PROJECT_WRITE),
  validate({ params: projectIdParamsSchema, body: changeProjectStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const project = await projectsService.changeProjectStatus(
      req.params.id as string,
      req.body as ChangeProjectStatusInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, project);
  }),
);

projectsRouter.post(
  '/:id/members',
  requirePermission(PERMISSIONS.PROJECT_WRITE),
  validate({ params: projectIdParamsSchema, body: projectMemberSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const project = await projectsService.addMember(
      req.params.id as string,
      req.body as ProjectMemberInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, project, 201);
  }),
);

projectsRouter.delete(
  '/:id/members/:userId',
  requirePermission(PERMISSIONS.PROJECT_WRITE),
  validate({ params: memberParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const project = await projectsService.removeMember(
      req.params.id as string,
      req.params.userId as string,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, project);
  }),
);

projectsRouter.get(
  '/:id/milestones',
  requirePermission(PERMISSIONS.PROJECT_READ),
  validate({ params: projectIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await projectsService.listMilestones(req.params.id as string, actor(req)));
  }),
);

projectsRouter.post(
  '/:id/milestones',
  requirePermission(PERMISSIONS.MILESTONE_WRITE),
  validate({ params: projectIdParamsSchema, body: createMilestoneSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const milestone = await projectsService.createMilestone(
      req.params.id as string,
      req.body as CreateMilestoneInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, milestone, 201);
  }),
);

projectsRouter.patch(
  '/:id/milestones/:milestoneId',
  requirePermission(PERMISSIONS.MILESTONE_WRITE),
  validate({
    params: projectIdParamsSchema.merge(milestoneIdParamsSchema),
    body: updateMilestoneSchema,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const milestone = await projectsService.updateMilestone(
      req.params.id as string,
      req.params.milestoneId as string,
      req.body as UpdateMilestoneInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, milestone);
  }),
);

projectsRouter.delete(
  '/:id/milestones/:milestoneId',
  requirePermission(PERMISSIONS.MILESTONE_WRITE),
  validate({ params: projectIdParamsSchema.merge(milestoneIdParamsSchema) }),
  asyncHandler(async (req: Request, res: Response) => {
    await projectsService.deleteMilestone(
      req.params.id as string,
      req.params.milestoneId as string,
      actor(req),
      auditContext(req),
    );
    sendNoContent(res);
  }),
);

projectsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.PROJECT_DELETE),
  validate({ params: projectIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await projectsService.deleteProject(req.params.id as string, actor(req), auditContext(req));
    sendNoContent(res);
  }),
);
