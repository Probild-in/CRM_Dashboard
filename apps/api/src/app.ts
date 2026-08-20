import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { apiRouter } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy, trust one hop so `req.ip` and rate limiting see
  // the real client address rather than the proxy's.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as { requestId?: string }).requestId ?? '',
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
      }),
    );
  }

  app.use('/api', apiRateLimiter, apiRouter);

  /*
   * Single-service deployment: this process also serves the built React client.
   *
   * Mounted after /api so an API route is never shadowed by a file, and the
   * catch-all is restricted to GET so a mistyped POST still reaches notFound
   * and returns JSON rather than an HTML page.
   */
  if (env.SERVE_WEB) {
    const webRoot = path.resolve(process.cwd(), env.WEB_DIST_DIR);

    // Vite fingerprints asset filenames, so they may be cached indefinitely.
    app.use(
      express.static(webRoot, {
        index: false,
        maxAge: '1y',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('cache-control', 'no-cache');
        },
      }),
    );

    // Client-side routes must survive a hard refresh.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webRoot, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
