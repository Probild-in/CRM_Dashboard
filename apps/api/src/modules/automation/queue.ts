import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env, isTest } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * The job layer.
 *
 * Redis is a dependency of the *worker*, not of the API. If it is unreachable
 * the CRM keeps working — reminders simply stop being emitted until it comes
 * back, and the scan picks up whatever it missed because every deadline is
 * re-read from the database on the next pass.
 */

export const AUTOMATION_QUEUE = 'probild-automation';

export const JOB = {
  SCAN: 'scan-deadlines',
  PRUNE: 'prune-notifications',
} as const;

let connection: Redis | null = null;
let queue: Queue | null = null;

export function getConnection(): Redis {
  if (connection) return connection;

  // BullMQ needs `maxRetriesPerRequest: null` — it manages its own retries and
  // an ioredis-level limit would abort blocking commands mid-wait.
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    /*
     * Back off, and stop after a minute of failure.
     *
     * ioredis retries forever by default, and an unreachable Redis then fills
     * the logs with the same stack trace several times a second — which buries
     * whatever actually went wrong. The API does not need Redis to serve
     * requests, so giving up quietly is the honest behaviour.
     */
    retryStrategy: (attempt) => (attempt > 10 ? null : Math.min(attempt * 500, 5_000)),
  });

  // Log the first failure properly, then once a minute at most.
  let lastLoggedAt = 0;
  client.on('error', (error: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < 60_000) return;
    lastLoggedAt = now;
    logger.error(
      { err: error, redis: env.REDIS_URL },
      'Redis is unreachable — automation reminders are paused. The rest of the API is unaffected.',
    );
  });

  connection = client;
  return connection;
}

export function getQueue(): Queue {
  queue ??= new Queue(AUTOMATION_QUEUE, { connection: getConnection() });
  return queue;
}

/** Runs every five minutes: often enough for a two-hour warning to be on time. */
export const SCAN_CRON = '*/5 * * * *';
/** Nightly, well outside working hours. */
export const PRUNE_CRON = '30 2 * * *';

const REPEATABLE: JobsOptions = {
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 100 },
};

/**
 * Registers the recurring jobs.
 *
 * Scheduler ids are fixed and `upsert` semantics apply, so restarting the
 * worker replaces the schedule rather than stacking a second copy of it.
 */
export async function scheduleRecurringJobs(): Promise<void> {
  const target = getQueue();

  await target.upsertJobScheduler(
    'recurring-scan',
    { pattern: SCAN_CRON },
    { name: JOB.SCAN, opts: REPEATABLE },
  );

  await target.upsertJobScheduler(
    'recurring-prune',
    { pattern: PRUNE_CRON },
    { name: JOB.PRUNE, opts: REPEATABLE },
  );

  logger.info({ scan: SCAN_CRON, prune: PRUNE_CRON }, 'Automation schedule registered');
}

/** Runs a scan immediately, outside the schedule. */
export async function enqueueScanNow(): Promise<string | undefined> {
  const job = await getQueue().add(JOB.SCAN, { manual: true }, REPEATABLE);
  return job.id;
}

export function createWorker(
  handlers: { scan: () => Promise<unknown>; prune: () => Promise<unknown> },
): Worker {
  return new Worker(
    AUTOMATION_QUEUE,
    async (job) => (job.name === JOB.PRUNE ? handlers.prune() : handlers.scan()),
    {
      connection: getConnection(),
      // One scan at a time. Concurrency would only race on the same rows, and
      // the dedupe key would reject the loser anyway.
      concurrency: 1,
    },
  );
}

export async function queueHealth(): Promise<{
  reachable: boolean;
  waiting: number;
  active: number;
  failed: number;
  error?: string;
}> {
  if (isTest) {
    return { reachable: false, waiting: 0, active: 0, failed: 0, error: 'disabled in tests' };
  }

  try {
    const target = getQueue();
    const [waiting, active, failed] = await Promise.all([
      target.getWaitingCount(),
      target.getActiveCount(),
      target.getFailedCount(),
    ]);
    return { reachable: true, waiting, active, failed };
  } catch (error) {
    return {
      reachable: false,
      waiting: 0,
      active: 0,
      failed: 0,
      error: error instanceof Error ? error.message : 'unknown',
    };
  }
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  connection?.disconnect();
  queue = null;
  connection = null;
}
