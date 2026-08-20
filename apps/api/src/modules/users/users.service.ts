import {
  AuditAction,
  EntityType,
  UserRole,
  UserStatus,
  type AuthUser,
  type PaginatedResult,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { deleteAuthUser, ensureAuthUser, setAuthPassword } from '../../lib/supabase.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { authUserSelect, toAuthUser } from '../auth/auth.service.js';
import { diffFields, recordAudit, type AuditInput } from '../audit/audit.service.js';
import {
  USER_SORT_FIELDS,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateProfileInput,
  type UpdateUserInput,
} from './users.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

/** Empty strings from optional form fields are stored as NULL, not "". */
function nullifyBlanks<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = value === '' ? null : value;
  }
  return output as T;
}

export async function listUsers(query: ListUsersQuery): Promise<PaginatedResult<AuthUser>> {
  const where: Prisma.UserWhereInput = {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { designation: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const sortBy = resolveSort(query.sortBy, USER_SORT_FIELDS, 'createdAt');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: authUserSelect,
      orderBy: { [sortBy]: query.sortOrder },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  return { items: rows.map(toAuthUser), meta: buildPaginationMeta(total, query) };
}

export async function getUser(id: string): Promise<AuthUser> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: authUserSelect });
  if (!user) {
    throw new NotFoundError('User');
  }
  return toAuthUser(user);
}

export async function createUser(input: CreateUserInput, audit: AuditMeta): Promise<AuthUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw new ConflictError('A user with this email address already exists.');
  }

  const { password, ...rest } = nullifyBlanks(input);

  // Supabase owns the credential; this row owns the profile. They share an id.
  const authId = await ensureAuthUser(rest.email, password);

  let user;
  try {
    user = await prisma.user.create({
      data: { ...rest, id: authId },
      select: authUserSelect,
    });
  } catch (error) {
    // Leaving an auth account with no profile would block the address forever.
    await deleteAuthUser(authId).catch(() => {});
    throw error;
  }

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.USER,
    entityId: user.id,
    summary: `Created user ${user.email}`,
    newValue: { email: user.email, role: user.role, status: user.status },
  });

  return toAuthUser(user);
}

/**
 * Updates a team member.
 *
 * Guards the last active super admin: demoting or suspending them would lock
 * everyone out of user administration.
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
  audit: AuditMeta,
): Promise<AuthUser> {
  const current = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: authUserSelect,
  });
  if (!current) {
    throw new NotFoundError('User');
  }

  const data = nullifyBlanks(input);

  const losesAdmin =
    current.role === UserRole.SUPER_ADMIN &&
    ((data.role !== undefined && data.role !== UserRole.SUPER_ADMIN) ||
      (data.status !== undefined && data.status !== UserStatus.ACTIVE));

  if (losesAdmin && (await countActiveSuperAdmins()) <= 1) {
    throw new ForbiddenError('The last active super admin cannot be demoted or suspended.');
  }

  if (data.email && data.email !== current.email) {
    const clash = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictError('A user with this email address already exists.');
    }
  }

  const updated = await prisma.user.update({ where: { id }, data, select: authUserSelect });

  const changes = diffFields(current as unknown as Record<string, unknown>, data);
  if (changes) {
    await recordAudit({
      ...audit,
      action: data.role && data.role !== current.role ? AuditAction.STATUS_CHANGED : AuditAction.UPDATED,
      entityType: EntityType.USER,
      entityId: id,
      summary: `Updated user ${updated.email}`,
      previousValue: changes.previous as never,
      newValue: changes.next as never,
    });
  }

  return toAuthUser(updated);
}

export async function updateOwnProfile(
  id: string,
  input: UpdateProfileInput,
  audit: AuditMeta,
): Promise<AuthUser> {
  const data = nullifyBlanks(input);
  const updated = await prisma.user.update({ where: { id }, data, select: authUserSelect });

  await recordAudit({
    ...audit,
    action: AuditAction.UPDATED,
    entityType: EntityType.USER,
    entityId: id,
    summary: 'Updated own profile',
    newValue: data as never,
  });

  return toAuthUser(updated);
}

/** Soft delete: the row stays so historical assignments still resolve. */
export async function deactivateUser(id: string, audit: AuditMeta): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    throw new NotFoundError('User');
  }
  if (user.id === audit.userId) {
    throw new ForbiddenError('You cannot deactivate your own account.');
  }
  if (user.role === UserRole.SUPER_ADMIN && (await countActiveSuperAdmins()) <= 1) {
    throw new ForbiddenError('The last active super admin cannot be deactivated.');
  }

  /*
   * No session revocation is needed. `requireAuth` re-reads the account on every
   * request and refuses anything soft-deleted or not ACTIVE, so access ends on
   * the next call rather than whenever a token would have expired — the same
   * guarantee the revoked refresh token used to give.
   */
  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), status: UserStatus.SUSPENDED },
  });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.USER,
    entityId: id,
    summary: `Deactivated user ${user.email}`,
  });
}

export async function resetUserPassword(
  id: string,
  newPassword: string,
  audit: AuditMeta,
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!user) {
    throw new NotFoundError('User');
  }

  // Supabase holds the credential and revokes that user's sessions itself.
  await setAuthPassword(id, newPassword);

  await prisma.user.update({
    where: { id },
    data: { passwordChangedAt: new Date() },
  });

  await recordAudit({
    ...audit,
    action: AuditAction.PASSWORD_CHANGED,
    entityType: EntityType.USER,
    entityId: id,
    summary: 'Password reset by an administrator',
  });
}

function countActiveSuperAdmins(): Promise<number> {
  return prisma.user.count({
    where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
  });
}
