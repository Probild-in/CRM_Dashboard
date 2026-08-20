import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

export const servicesRouter = Router();

const listQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('false'),
});

/**
 * The service catalogue. Read-only for now — leads, quotations and projects all
 * pick from it, and it is seeded rather than edited. Editing arrives with the
 * settings module.
 */
servicesRouter.get(
  '/',
  requireAuth,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const { includeInactive } = req.query as unknown as z.infer<typeof listQuerySchema>;
    const services = await prisma.service.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, description: true, isActive: true },
    });
    sendSuccess(res, services);
  }),
);
