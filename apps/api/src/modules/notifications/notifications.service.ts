import {
  type EntityType,
  type NotificationType,
  type PaginatedResult,
  type Priority,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { buildPaginationMeta, toSkipTake } from '../../lib/pagination.js';
import { NotFoundError } from '../../lib/errors.js';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  priority: Priority;
  title: string;
  message: string;
  entityType?: EntityType | null;
  entityId?: string | null;
  actionUrl?: string | null;
}

const notificationSelect = {
  id: true,
  type: true,
  priority: true,
  title: true,
  message: true,
  entityType: true,
  entityId: true,
  actionUrl: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationView = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

/** Writes one notification. Callers hold the idempotency guarantee, not this. */
export async function create(
  input: NotificationInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      priority: input.priority,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actionUrl: input.actionUrl ?? null,
    },
  });
}

export async function createMany(
  inputs: NotificationInput[],
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  if (inputs.length === 0) return 0;

  const result = await tx.notification.createMany({
    data: inputs.map((input) => ({
      userId: input.userId,
      type: input.type,
      priority: input.priority,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actionUrl: input.actionUrl ?? null,
    })),
  });

  return result.count;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  unreadOnly?: boolean;
  type?: NotificationType;
}

export async function list(
  userId: string,
  query: ListQuery,
): Promise<PaginatedResult<NotificationView>> {
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(query.unreadOnly ? { readAt: null } : {}),
    ...(query.type ? { type: query.type } : {}),
  };

  const { skip, take } = toSkipTake(query);

  const [items, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.notification.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(total, query) };
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, id: string): Promise<NotificationView> {
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) {
    throw new NotFoundError('Notification');
  }

  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
    select: notificationSelect,
  });
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
