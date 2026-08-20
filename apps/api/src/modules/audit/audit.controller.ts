import type { Request, Response } from 'express';
import { AuditAction, EntityType } from '@probild/shared';
import { z } from 'zod';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { buildPaginationMeta, paginationQuerySchema, toSkipTake } from '../../lib/pagination.js';
import { sendPaginated } from '../../lib/http.js';

export const listAuditQuerySchema = paginationQuerySchema.extend({
  entityType: z.nativeEnum(EntityType).optional(),
  entityId: z.string().uuid().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  userId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as z.infer<typeof listAuditQuerySchema>;

  const where: Prisma.AuditLogWhereInput = {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search ? { summary: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const { skip, take } = toSkipTake(query);

  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: query.sortOrder },
      skip,
      take,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  sendPaginated(res, items, buildPaginationMeta(total, query));
}
