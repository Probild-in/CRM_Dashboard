import type { Request } from 'express';
import type { AuditAction, EntityType } from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

export interface AuditInput {
  userId?: string | null;
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  summary?: string;
  previousValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Writes one audit row.
 *
 * Auditing must never break the operation it describes, so failures are logged
 * and swallowed. Pass `tx` when the trail has to commit with the change itself.
 */
export async function recordAudit(
  input: AuditInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary ?? null,
        previousValue: input.previousValue ?? undefined,
        newValue: input.newValue ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 255) ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, audit: { ...input, previousValue: undefined, newValue: undefined } },
      'Failed to write audit log');
  }
}

/** Pulls the request metadata every audit row wants. */
export function auditContext(req: Request): Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'> {
  return {
    userId: req.user?.id ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

/**
 * Reduces a before/after pair to only the fields that actually changed, so
 * audit rows stay small and readable.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { previous: Record<string, unknown>; next: Record<string, unknown> } | null {
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const oldValue = before[key];
    const changed =
      oldValue instanceof Date || value instanceof Date
        ? String(oldValue) !== String(value)
        : JSON.stringify(oldValue ?? null) !== JSON.stringify(value ?? null);
    if (changed) {
      previous[key] = oldValue ?? null;
      next[key] = value ?? null;
    }
  }

  return Object.keys(next).length > 0 ? { previous, next } : null;
}
