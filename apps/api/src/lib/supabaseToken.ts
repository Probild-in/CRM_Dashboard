import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

/**
 * Verification of Supabase access tokens.
 *
 * Supabase signs with asymmetric keys (ES256) and publishes the public half at
 * a JWKS endpoint. Verifying locally means no network round trip per request,
 * and a key rotation needs no redeploy — `jose` refetches when it meets a key
 * id it has not seen, and caches otherwise.
 *
 * Note this only establishes that the token is authentic and unexpired. Whether
 * the account still exists, is active and what it may do is decided by
 * `requireAuth`, which re-reads the user on every request.
 */
const jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

export interface SupabaseTokenClaims {
  /** The `auth.users` id, which is also the `users.id` of the profile row. */
  sub: string;
  /** Supabase's session identifier, carried into the audit trail. */
  sessionId: string;
}

export async function verifySupabaseToken(token: string): Promise<SupabaseTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('Token carries no subject.');
    }

    return {
      sub: payload.sub,
      sessionId: typeof payload.session_id === 'string' ? payload.session_id : payload.sub,
    };
  } catch {
    // Deliberately opaque: which check failed is not the caller's business.
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }
}
