import { Router } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './users.controller.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetUserPasswordSchema,
  updateProfileSchema,
  updateUserSchema,
  userIdParamsSchema,
} from './users.schemas.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

// Anyone signed in may edit their own profile.
usersRouter.patch(
  '/me',
  validate({ body: updateProfileSchema }),
  asyncHandler(controller.updateProfile),
);

usersRouter.get(
  '/',
  requirePermission(PERMISSIONS.USER_READ),
  validate({ query: listUsersQuerySchema }),
  asyncHandler(controller.list),
);

usersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.USER_READ),
  validate({ params: userIdParamsSchema }),
  asyncHandler(controller.getById),
);

usersRouter.post(
  '/',
  requirePermission(PERMISSIONS.USER_WRITE),
  validate({ body: createUserSchema }),
  asyncHandler(controller.create),
);

usersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.USER_WRITE),
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  asyncHandler(controller.update),
);

usersRouter.post(
  '/:id/reset-password',
  requirePermission(PERMISSIONS.USER_WRITE),
  validate({ params: userIdParamsSchema, body: resetUserPasswordSchema }),
  asyncHandler(controller.resetPassword),
);

usersRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.USER_DELETE),
  validate({ params: userIdParamsSchema }),
  asyncHandler(controller.deactivate),
);
