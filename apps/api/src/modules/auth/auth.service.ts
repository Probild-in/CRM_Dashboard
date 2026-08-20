import { AuditAction, EntityType, type AuthUser } from '@probild/shared';
import { prisma } from '../../lib/prisma.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { passwordIsCorrect, setAuthPassword } from '../../lib/supabase.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * What is left of the auth module after Supabase Auth took over identity.
 *
 * Signing in, refreshing and signing out all happen between the browser and
 * Supabase directly — there is no `/auth/login` here any more. What remains is
 * the part Supabase does not model: who this person is inside Probild, and the
 * audit trail.
 */

type UserRecord = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  designation: string | null;
  avatarUrl: string | null;
  role: AuthUser['role'];
  status: AuthUser['status'];
  timezone: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const authUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  designation: true,
  avatarUrl: true,
  role: true,
  status: true,
  timezone: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    designation: user.designation,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function getSessionUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: authUserSelect,
  });
  if (!user) {
    throw new UnauthorizedError('This account no longer exists.');
  }
  return toAuthUser(user);
}

/**
 * Changes the signed-in person's password.
 *
 * Supabase holds the credential, so proving the current password means asking
 * Supabase to accept it — a sign-in attempt that is thrown away. Doing it here
 * rather than letting the browser call Supabase directly keeps the audit entry
 * on the server, where it cannot be skipped.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  context: SessionContext,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true },
  });

  if (!user) {
    throw new UnauthorizedError('This account no longer exists.');
  }

  if (!(await passwordIsCorrect(user.email, currentPassword))) {
    throw new UnauthorizedError('Your current password is incorrect.');
  }

  await setAuthPassword(userId, newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordChangedAt: new Date() },
  });

  await recordAudit({
    userId,
    action: AuditAction.PASSWORD_CHANGED,
    entityType: EntityType.USER,
    entityId: userId,
    summary: 'Password changed',
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}
