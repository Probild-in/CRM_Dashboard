import type { Request, Response } from 'express';
import { permissionsForRole } from '@probild/shared';
import { sendNoContent, sendSuccess } from '../../lib/http.js';
import * as authService from './auth.service.js';

/**
 * Sign-in, refresh and sign-out are gone: the browser holds a Supabase session
 * and talks to Supabase for all three. What is left is the part that needs the
 * database — who the caller is, and changing a password with an audit entry.
 */

function sessionContext(req: Request): authService.SessionContext {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await authService.getSessionUser(req.user!.id);
  sendSuccess(res, { user, permissions: permissionsForRole(user.role) });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  await authService.changePassword(req.user!.id, currentPassword, newPassword, sessionContext(req));
  sendNoContent(res);
}
