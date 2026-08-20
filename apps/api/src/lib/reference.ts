import type { Prisma } from './prisma.js';

/** Prefixes for the human-readable references shown in the UI. */
export const REFERENCE_PREFIX = {
  LEAD: 'LEAD',
  CLIENT: 'CLT',
  DEAL: 'DEAL',
  QUOTATION: 'QT',
  PROJECT: 'PRJ',
  TASK: 'TSK',
  PAYMENT: 'PAY',
} as const;

export type ReferencePrefix = (typeof REFERENCE_PREFIX)[keyof typeof REFERENCE_PREFIX];

/**
 * Produces the next reference for an entity, e.g. `LEAD-000042`.
 *
 * Runs inside the caller's transaction and takes a row lock on the counter so
 * two concurrent creates cannot claim the same number.
 */
export async function nextReference(
  tx: Prisma.TransactionClient,
  prefix: ReferencePrefix,
): Promise<string> {
  const key = `reference_counter.${prefix}`;

  const rows = await tx.$queryRaw<Array<{ value: unknown }>>`
    SELECT value FROM system_settings WHERE "key" = ${key} FOR UPDATE
  `;

  const current = rows.length > 0 ? Number(rows[0]?.value ?? 0) : 0;
  const next = Number.isFinite(current) ? current + 1 : 1;

  if (rows.length === 0) {
    await tx.systemSetting.create({
      data: { key, value: next, description: `Sequence counter for ${prefix} references` },
    });
  } else {
    await tx.systemSetting.update({ where: { key }, data: { value: next } });
  }

  return `${prefix}-${String(next).padStart(6, '0')}`;
}
