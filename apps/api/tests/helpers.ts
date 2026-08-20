import type { Express } from 'express';
import { UserRole, UserStatus, type Permission } from '@probild/shared';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createClient } from '@supabase/supabase-js';
import { env } from '../src/config/env.js';
import { ensureAuthUser } from '../src/lib/supabase.js';

export const TEST_PASSWORD = 'Testing123!';

/**
 * Every table the suite writes to. Order is irrelevant — CASCADE handles the
 * foreign keys — but the list is kept explicit so a new table is a deliberate
 * addition rather than a silent omission.
 */
const TABLES = [
  'audit_logs',
  'notifications',
  'automation_executions',
  'documents',
  'document_sends',
  'payments',
  'calendar_events',
  'calendar_connections',
  'meeting_attendees',
  'meetings',
  'task_comments',
  'tasks',
  'milestones',
  'project_services',
  'project_members',
  'projects',
  'pricing_history',
  'quotation_items',
  'quotations',
  'deals',
  'lead_activities',
  'leads',
  'contacts',
  'clients',
  'services',
  'system_settings',
  'users',
];

/**
 * Clears the test schema between cases.
 *
 * Postgres TRUNCATE is transactional and CASCADE satisfies the foreign keys, so
 * one statement replaces the dependency-ordered deletes MySQL required.
 */
export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export function buildTestApp(): Express {
  return createApp();
}

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
}

export async function createTestUser(
  role: UserRole,
  overrides: Partial<{ email: string; status: UserStatus; password: string }> = {},
): Promise<TestUser> {
  // @probild.test is reserved for the suite and purged in global teardown.
  const email = overrides.email ?? `${role.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@probild.test`;

  const authId = await ensureAuthUser(email, overrides.password ?? TEST_PASSWORD);

  return prisma.user.create({
    data: {
      id: authId,
      email,
      firstName: 'Test',
      lastName: role,
      role,
      status: overrides.status ?? UserStatus.ACTIVE,
    },
    select: { id: true, email: true, role: true },
  });
}

export interface LoginResult {
  accessToken: string;
  permissions: Permission[];
}

/**
 * Signs in against Supabase Auth, exactly as the browser does, then reads the
 * caller's permissions back through the API.
 *
 * `app` is still taken so no caller had to change when auth moved.
 */
export async function loginAs(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<LoginResult> {
  /*
   * A fresh client per sign-in, with the publishable key — exactly what the
   * browser does. Signing in on the shared admin client would demote it from
   * service-role to that user, and every later Storage or Admin call in the
   * process would then fail against RLS.
   */
  const browser = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await browser.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Login failed for ${email}: ${error?.message ?? 'no session returned'}`);
  }

  const { default: request } = await import('supertest');
  const me = await request(app)
    .get('/api/auth/me')
    .set(authHeader(data.session.access_token));

  if (me.status !== 200) {
    throw new Error(`/auth/me failed for ${email}: ${me.status} ${me.text}`);
  }

  return { accessToken: data.session.access_token, permissions: me.body.data.permissions };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
