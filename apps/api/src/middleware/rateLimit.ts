import rateLimit from 'express-rate-limit';
import { ApiErrorCode } from '@probild/shared';
import { isTest } from '../config/env.js';

const shared = {
  standardHeaders: true as const,
  legacyHeaders: false,
  // Rate limits would make integration tests flaky and prove nothing.
  skip: () => isTest,
  message: {
    success: false,
    error: {
      code: ApiErrorCode.RATE_LIMITED,
      message: 'Too many requests. Please slow down and try again shortly.',
    },
  },
};

/** Baseline limit applied to the whole API surface. */
export const apiRateLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 300,
});

/** Tight limit on credential endpoints to blunt brute-force attempts. */
export const authRateLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
});
