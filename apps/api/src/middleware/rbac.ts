import type { NextFunction, Request, Response } from 'express';
import { UserRole, roleHasPermission, type Permission } from '@probild/shared';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

/**
 * Authorisation is enforced here, on the server. The web client uses the same
 * permission map only to decide what to render.
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    const allowed = permissions.every((permission) =>
      roleHasPermission(req.user!.role, permission),
    );
    if (!allowed) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

/** Passes when the caller holds *any* of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    const allowed = permissions.some((permission) => roleHasPermission(req.user!.role, permission));
    if (!allowed) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN);
