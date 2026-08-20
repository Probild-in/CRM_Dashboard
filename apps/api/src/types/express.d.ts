import type { UserRole } from '@probild/shared';

declare global {
  namespace Express {
    /** Set by `requireAuth`; present on every authenticated request. */
    interface AuthenticatedUser {
      id: string;
      email: string;
      role: UserRole;
      sessionId: string;
    }

    interface Request {
      user?: AuthenticatedUser;
      requestId: string;
    }
  }
}

export {};
