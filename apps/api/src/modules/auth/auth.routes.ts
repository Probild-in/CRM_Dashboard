import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { changePasswordSchema } from './auth.schemas.js';

export const authRouter = Router();

/*
 * There is no `/login`, `/refresh` or `/logout` here. The browser signs in
 * against Supabase directly and sends the resulting token as a Bearer header;
 * Supabase handles refresh and sign-out.
 */

authRouter.get('/me', requireAuth, asyncHandler(controller.me));

authRouter.post(
  '/change-password',
  requireAuth,
  authRateLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(controller.changePassword),
);
