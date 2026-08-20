import type { NextFunction, Request, Response } from 'express';
import { UserStatus } from '@probild/shared';
import { UnauthorizedError } from '../lib/errors.js';
import { verifySupabaseToken } from '../lib/supabaseToken.js';
import { prisma } from '../lib/prisma.js';

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the access token and confirms the account is still usable.
 *
 * The database check means a suspended or deleted user loses access at once,
 * rather than when their token happens to expire.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new UnauthorizedError('Authentication is required.');
    }

    const payload = await verifySupabaseToken(token);

    const user = await prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!user) {
      throw new UnauthorizedError('This account no longer exists.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedError('This account is not active.');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: payload.sessionId,
    };
    next();
  } catch (error) {
    next(error);
  }
}
