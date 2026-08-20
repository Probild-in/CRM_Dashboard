import type { Request, Response } from 'express';
import { sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { auditContext } from '../audit/audit.service.js';
import * as usersService from './users.service.js';
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateProfileInput,
  UpdateUserInput,
} from './users.schemas.js';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await usersService.listUsers(req.query as unknown as ListUsersQuery);
  sendPaginated(res, result.items, result.meta);
}

export async function getById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await usersService.getUser(req.params.id as string));
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = await usersService.createUser(req.body as CreateUserInput, auditContext(req));
  sendSuccess(res, user, 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = await usersService.updateUser(
    req.params.id as string,
    req.body as UpdateUserInput,
    auditContext(req),
  );
  sendSuccess(res, user);
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const user = await usersService.updateOwnProfile(
    req.user!.id,
    req.body as UpdateProfileInput,
    auditContext(req),
  );
  sendSuccess(res, user);
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  await usersService.deactivateUser(req.params.id as string, auditContext(req));
  sendNoContent(res);
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { newPassword } = req.body as { newPassword: string };
  await usersService.resetUserPassword(req.params.id as string, newPassword, auditContext(req));
  sendNoContent(res);
}
