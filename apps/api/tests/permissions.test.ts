import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  PERMISSIONS,
  UserRole,
  canReadAll,
  permissionsForRole,
  roleHasPermission,
} from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { authHeader, buildTestApp, createTestUser, loginAs, resetDatabase } from './helpers.js';

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

describe('permission matrix', () => {
  it('gives the super admin every permission', () => {
    const granted = permissionsForRole(UserRole.SUPER_ADMIN);
    expect(granted).toEqual(expect.arrayContaining(Object.values(PERMISSIONS)));
  });

  it('does not let sales read the audit trail or delete users', () => {
    expect(roleHasPermission(UserRole.SALES, PERMISSIONS.AUDIT_READ)).toBe(false);
    expect(roleHasPermission(UserRole.SALES, PERMISSIONS.USER_DELETE)).toBe(false);
  });

  it('scopes cross-record reads per role', () => {
    expect(canReadAll(UserRole.SALES, 'lead')).toBe(true);
    expect(canReadAll(UserRole.EMPLOYEE, 'lead')).toBe(false);
    expect(canReadAll(UserRole.PROJECT_MANAGER, 'task')).toBe(true);
    expect(canReadAll(UserRole.EMPLOYEE, 'task')).toBe(false);
  });
});

describe('server-side enforcement', () => {
  it('lets a super admin create a user', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);

    const response = await request(app)
      .post('/api/users')
      .set(authHeader(session.accessToken))
      .send({
        email: 'new.hire@probild.test',
        password: 'Testing123!',
        firstName: 'New',
        lastName: 'Hire',
        role: UserRole.EMPLOYEE,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe('new.hire@probild.test');
  });

  it('refuses user creation for an employee', async () => {
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await request(app)
      .post('/api/users')
      .set(authHeader(session.accessToken))
      .send({
        email: 'sneaky@probild.test',
        password: 'Testing123!',
        firstName: 'Sneaky',
        lastName: 'User',
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses the audit trail to a project manager but allows it for a super admin', async () => {
    const manager = await createTestUser(UserRole.PROJECT_MANAGER);
    const admin = await createTestUser(UserRole.SUPER_ADMIN);

    const managerSession = await loginAs(app, manager.email);
    const adminSession = await loginAs(app, admin.email);

    expect(
      (await request(app).get('/api/audit').set(authHeader(managerSession.accessToken))).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/audit').set(authHeader(adminSession.accessToken))).status,
    ).toBe(200);
  });

  it('lets any signed-in user edit their own profile', async () => {
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await request(app)
      .patch('/api/users/me')
      .set(authHeader(session.accessToken))
      .send({ designation: 'Frontend Engineer' });

    expect(response.status).toBe(200);
    expect(response.body.data.designation).toBe('Frontend Engineer');
  });

  it('rejects a duplicate email with a conflict rather than a server error', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);

    const response = await request(app)
      .post('/api/users')
      .set(authHeader(session.accessToken))
      .send({
        email: admin.email,
        password: 'Testing123!',
        firstName: 'Copy',
        lastName: 'Cat',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
});

describe('super admin safety net', () => {
  it('refuses to demote the last active super admin', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);

    const response = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set(authHeader(session.accessToken))
      .send({ role: UserRole.EMPLOYEE });

    expect(response.status).toBe(403);
  });

  it('allows a demotion once a second super admin exists', async () => {
    const first = await createTestUser(UserRole.SUPER_ADMIN);
    const second = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, first.email);

    const response = await request(app)
      .patch(`/api/users/${second.id}`)
      .set(authHeader(session.accessToken))
      .send({ role: UserRole.SALES });

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe(UserRole.SALES);
  });

  it('refuses self-deactivation', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);

    const response = await request(app)
      .delete(`/api/users/${admin.id}`)
      .set(authHeader(session.accessToken));

    expect(response.status).toBe(403);
  });

  it('soft-deletes a user and ends their access immediately', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const target = await createTestUser(UserRole.EMPLOYEE);
    const targetSession = await loginAs(app, target.email);
    const session = await loginAs(app, admin.email);

    // The target's token works before the deletion.
    await request(app)
      .get('/api/auth/me')
      .set(authHeader(targetSession.accessToken))
      .expect(200);

    const response = await request(app)
      .delete(`/api/users/${target.id}`)
      .set(authHeader(session.accessToken));

    expect(response.status).toBe(204);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.deletedAt).not.toBeNull();

    /*
     * Their Supabase token is still valid and unexpired — Probild cannot revoke
     * it. Access ends because requireAuth re-reads the account on every request,
     * which is the same guarantee the revoked refresh token used to give.
     */
    await request(app)
      .get('/api/auth/me')
      .set(authHeader(targetSession.accessToken))
      .expect(401);
  });
});
