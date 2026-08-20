import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';

async function main(): Promise<void> {
  // Fail fast if the database is unreachable, rather than on the first request.
  await prisma.$queryRaw`SELECT 1`;

  const app = createApp();

  /*
   * Single-service deployment: run the automation worker in this process.
   *
   * A failure here must not stop the API — the CRM works without the worker,
   * reminders simply stop being raised, and the next scan catches up.
   */
  let stopWorker: (() => Promise<void>) | null = null;
  if (env.RUN_WORKER) {
    try {
      const { startAutomationWorker } = await import('./worker.js');
      stopWorker = await startAutomationWorker();
    } catch (error) {
      logger.error({ err: error }, 'The automation worker could not start; the API continues');
    }
  }
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `Probild CRM API listening on http://localhost:${env.PORT}`,
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void Promise.resolve(stopWorker?.())
        .catch(() => {})
        .then(() => disconnectPrisma())
        .finally(() => process.exit(0));
    });
    // Do not let a hung connection block the restart forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start the API');
  process.exit(1);
});
