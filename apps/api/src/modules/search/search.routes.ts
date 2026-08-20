import { Router } from 'express';
import { z } from 'zod';
import { EntityType, PERMISSIONS, roleHasPermission } from '@probild/shared';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { searchClauses, visibilityFilter } from '../leads/leads.service.js';

export const searchRouter = Router();

const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least two characters.').max(120),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export interface SearchHit {
  entityType: EntityType;
  id: string;
  /** The human reference, when the record has one. */
  reference: string | null;
  title: string;
  subtitle: string | null;
  url: string;
}

/**
 * Global search.
 *
 * Each resource contributes hits only if the caller may read it, and each is
 * scoped by the same visibility rule its own module uses. Later phases add
 * clients, quotations, projects, tasks and payments to the same shape.
 */
searchRouter.get(
  '/',
  requireAuth,
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req, res) => {
    const { q, limit } = req.query as unknown as z.infer<typeof searchQuerySchema>;
    const user = req.user!;
    const hits: SearchHit[] = [];

    if (roleHasPermission(user.role, PERMISSIONS.LEAD_READ)) {
      const leads = await prisma.lead.findMany({
        where: {
          deletedAt: null,
          ...visibilityFilter({ id: user.id, role: user.role }),
          OR: searchClauses(q),
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          reference: true,
          companyName: true,
          contactPerson: true,
          status: true,
        },
      });

      hits.push(
        ...leads.map((lead) => ({
          entityType: EntityType.LEAD,
          id: lead.id,
          reference: lead.reference,
          title: lead.companyName,
          subtitle: [lead.contactPerson, lead.status.replace(/_/g, ' ').toLowerCase()]
            .filter(Boolean)
            .join(' · '),
          url: `/leads/${lead.id}`,
        })),
      );
    }

    if (roleHasPermission(user.role, PERMISSIONS.USER_READ)) {
      const users = await prisma.user.findMany({
        where: {
          deletedAt: null,
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: { firstName: 'asc' },
        take: limit,
        select: { id: true, firstName: true, lastName: true, email: true, designation: true },
      });

      hits.push(
        ...users.map((member) => ({
          entityType: EntityType.USER,
          id: member.id,
          reference: null,
          title: `${member.firstName} ${member.lastName}`,
          subtitle: member.designation ?? member.email,
          url: '/team',
        })),
      );
    }

    sendSuccess(res, hits);
  }),
);
