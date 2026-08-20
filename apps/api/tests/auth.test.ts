import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { UserRole, UserStatus } from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import {
  TEST_PASSWORD,
  authHeader,
  buildTestApp,
  createTestUser,
  loginAs,
  resetDatabase,
} from './helpers.js';

/*
 * Signing in, refreshing and signing out are Supabase's concern now and are not
 * tested here — there is no endpoint for them. What this file covers is the
 * boundary Probild still owns: that a token is genuinely from Supabase, that
 * the account behind it is still allowed in, and that changing a password works
 * and is recorded.
 *
 * Gone with the migration, deliberately (spec §9): the five-failure account
 * lockout, refresh-token rotation, and family revocation on replay.
 */

let app: Express;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectPrisma();
});

describe('GET /api/auth/me', () => {
  it('returns the caller and their permissions', async () => {
    const user = await createTestUser(UserRole.PROJECT_MANAGER);
    const session = await loginAs(app, user.email);

    const response = await request(app).get('/api/auth/me').set(authHeader(session.accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(user.id);
    expect(response.body.data.permissions).toContain('project:write');
  });

  it('uses the Supabase account id as the Probild user id', async () => {
    const user = await createTestUser(UserRole.SALES);
    const session = await loginAs(app, user.email);

    // The token's subject is the auth.users id; the profile row must share it,
    // because that identity is the whole join between Supabase and Probild.
    const [, payload] = session.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64').toString()) as { sub: string };

    expect(claims.sub).toBe(user.id);
  });

  it('rejects a missing or malformed token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(authHeader('nonsense'))).status).toBe(401);
  });

  it('rejects a token that was not signed by Supabase', async () => {
    // Well-formed and plausible, but self-signed. Only the signature check
    // stands between this and a session as an arbitrary user.
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: randomUUID(),
          aud: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url'),
      'not-a-real-signature',
    ].join('.');

    const response = await request(app).get('/api/auth/me').set(authHeader(forged));

    expect(response.status).toBe(401);
  });

  it('rejects a token belonging to a deactivated account', async () => {
    const user = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    const response = await request(app).get('/api/auth/me').set(authHeader(session.accessToken));

    // The token is still valid at Supabase. Access ends because the API re-reads
    // the account on every request rather than trusting the token alone.
    expect(response.status).toBe(401);
  });

  it('rejects a token belonging to a suspended account', async () => {
    const user = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.SUSPENDED },
    });

    const response = await request(app).get('/api/auth/me').set(authHeader(session.accessToken));

    expect(response.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password so the new one signs in', async () => {
    const user = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, user.email);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew123!' });

    expect(response.status).toBe(204);

    await expect(loginAs(app, user.email, 'BrandNew123!')).resolves.toBeDefined();
  });

  it('records the change in the audit trail', async () => {
    const user = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, user.email);

    await request(app)
      .post('/api/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew123!' })
      .expect(204);

    const entry = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: 'PASSWORD_CHANGED' },
    });

    expect(entry).not.toBeNull();
  });

  it('rejects an incorrect current password', async () => {
    const user = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, user.email);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'NotIt123!', newPassword: 'BrandNew123!' });

    expect(response.status).toBe(401);
  });

  it('rejects a new password that fails the policy', async () => {
    const user = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, user.email);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'weakpass' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
