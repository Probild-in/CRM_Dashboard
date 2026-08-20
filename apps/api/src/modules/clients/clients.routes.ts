import { Router } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './clients.controller.js';
import {
  clientIdParamsSchema,
  contactIdParamsSchema,
  createClientSchema,
  createContactSchema,
  listClientsQuerySchema,
  updateClientSchema,
  updateContactSchema,
} from './clients.schemas.js';

export const clientsRouter = Router();

clientsRouter.use(requireAuth);

clientsRouter.get(
  '/',
  requirePermission(PERMISSIONS.CLIENT_READ),
  validate({ query: listClientsQuerySchema }),
  asyncHandler(controller.list),
);

clientsRouter.post(
  '/',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  validate({ body: createClientSchema }),
  asyncHandler(controller.create),
);

clientsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.CLIENT_READ),
  validate({ params: clientIdParamsSchema }),
  asyncHandler(controller.getById),
);

clientsRouter.get(
  '/:id/overview',
  requirePermission(PERMISSIONS.CLIENT_READ),
  validate({ params: clientIdParamsSchema }),
  asyncHandler(controller.overview),
);

clientsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  validate({ params: clientIdParamsSchema, body: updateClientSchema }),
  asyncHandler(controller.update),
);

clientsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.CLIENT_DELETE),
  validate({ params: clientIdParamsSchema }),
  asyncHandler(controller.remove),
);

clientsRouter.get(
  '/:id/contacts',
  requirePermission(PERMISSIONS.CLIENT_READ),
  validate({ params: clientIdParamsSchema }),
  asyncHandler(controller.listContacts),
);

clientsRouter.post(
  '/:id/contacts',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  validate({ params: clientIdParamsSchema, body: createContactSchema }),
  asyncHandler(controller.createContact),
);

clientsRouter.patch(
  '/:id/contacts/:contactId',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  validate({ params: contactIdParamsSchema, body: updateContactSchema }),
  asyncHandler(controller.updateContact),
);

clientsRouter.delete(
  '/:id/contacts/:contactId',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  validate({ params: contactIdParamsSchema }),
  asyncHandler(controller.removeContact),
);
