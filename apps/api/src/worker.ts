import { pathToFileURL } from 'node:url';
import { logger } from './lib/logger.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';
import { env } from './config/env.js';
import { pruneNotifications, run } from './modules/automation/engine.js';
import { closeQueue, createWorker, scheduleRecurringJobs } from './modules/automation/queue.js';

/**
 * The automation worker.
 *
 * A separate process from the API on purpose: a long scan must never sit in
 * front of somebody's HTTP request, and the two scale independently.
 *
 *   npm run worker
 */
/**
 * Starts the automation worker and returns a function that stops it.
 *
 * Exported so a single-service deployment can run the worker inside the API
 * process (RUN_WORKER=true). Running it separately is still the better shape —
 * a long scan competes with live requests when they share a process — but the
 * option exists for a one-service deployment.
 */
export async function startAutomationWorker(): Promise<() => Promise<void>> {
  logger.info({ redis: env.REDIS_URL }, 'Automation worker starting');

  await scheduleRecurringJobs();

  const worker = createWorker({
    scan: () => run(),
    prune: () => pruneNotifications(),
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, name: job.name }, 'Automation job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, name: job?.name, err: error }, 'Automation job failed');
  });

  // Run once at boot so a restart catches anything that came due while it was down.
  await run();

  return async () => {
    await worker.close();
    await closeQueue();
  };
}

async function main(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;

  const stop = await startAutomationWorker();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Automation worker shutting down');
    await stop();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/*
 * Only run standalone when this file IS the entry point.
 *
 * `server.ts` imports `startAutomationWorker` from here when RUN_WORKER is set;
 * without this guard that import would also start a second, unmanaged worker
 * and register the recurring jobs twice.
 */
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    logger.fatal({ err: error }, 'The automation worker could not start');
    process.exit(1);
  });
}
