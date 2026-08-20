import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { MilestoneStatus, ProjectStatus, TaskStatus, UserRole } from '@probild/shared';
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

/** A project manager sees everything being delivered, so most cases use one. */
async function managerSession() {
  const user = await createTestUser(UserRole.PROJECT_MANAGER);
  const session = await loginAs(app, user.email);
  return { user, token: session.accessToken };
}

async function makeClient(token: string, companyName = 'ABC Technologies') {
  const response = await request(app)
    .post('/api/clients')
    .set(authHeader(token))
    .send({ companyName });
  if (response.status !== 201) {
    throw new Error(`Client setup failed: ${response.status} ${response.text}`);
  }
  return response.body.data;
}

/** Clients need a writer; a project manager may read them but not create them. */
async function clientViaAdmin(companyName = 'ABC Technologies') {
  const admin = await createTestUser(UserRole.SUPER_ADMIN);
  const session = await loginAs(app, admin.email);
  return makeClient(session.accessToken, companyName);
}

async function makeProject(token: string, clientId: string, overrides = {}) {
  return request(app)
    .post('/api/projects')
    .set(authHeader(token))
    .send({ clientId, name: 'Website rebuild', value: 800000, currency: 'INR', ...overrides });
}

describe('POST /api/projects', () => {
  it('creates a project with a sequential reference', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();

    const first = await makeProject(token, client.id);
    const second = await makeProject(token, client.id, { name: 'Mobile app' });

    expect(first.status).toBe(201);
    expect(first.body.data.reference).toBe('PRJ-000001');
    expect(second.body.data.reference).toBe('PRJ-000002');
  });

  it('puts the manager on the team automatically', async () => {
    const { user, token } = await managerSession();
    const client = await clientViaAdmin();

    const response = await makeProject(token, client.id);

    expect(response.body.data.manager.id).toBe(user.id);
    expect(response.body.data.members.map((m: { user: { id: string } }) => m.user.id)).toContain(
      user.id,
    );
  });

  it('does not duplicate the manager when they are also listed as a member', async () => {
    const { user, token } = await managerSession();
    const client = await clientViaAdmin();

    const response = await makeProject(token, client.id, {
      managerId: user.id,
      memberIds: [user.id],
    });

    expect(response.body.data.members).toHaveLength(1);
  });

  it('refuses a delivery date before the start date', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();

    const response = await makeProject(token, client.id, {
      startDate: '2026-09-01',
      deliveryDate: '2026-08-01',
    });

    expect(response.status).toBe(400);
  });

  it('refuses a project for a client that does not exist', async () => {
    const { token } = await managerSession();

    const response = await makeProject(token, '11111111-1111-4111-8111-111111111111');

    expect(response.status).toBe(422);
  });

  it('refuses project creation to sales', async () => {
    const client = await clientViaAdmin();
    const sales = await createTestUser(UserRole.SALES);
    const session = await loginAs(app, sales.email);

    const response = await makeProject(session.accessToken, client.id);

    expect(response.status).toBe(403);
  });
});

describe('project visibility', () => {
  it('shows an employee only the projects they are on', async () => {
    const manager = await managerSession();
    const client = await clientViaAdmin();
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const employeeSession = await loginAs(app, employee.email);

    await makeProject(manager.token, client.id, { name: 'Not theirs' });
    await makeProject(manager.token, client.id, { name: 'Theirs', memberIds: [employee.id] });

    const response = await request(app)
      .get('/api/projects')
      .set(authHeader(employeeSession.accessToken));

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Theirs');
  });

  it('answers 404 for a project outside the caller’s scope', async () => {
    const manager = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(manager.token, client.id);

    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await request(app)
      .get(`/api/projects/${project.body.data.id}`)
      .set(authHeader(session.accessToken));

    expect(response.status).toBe(404);
  });
});

describe('milestones drive project progress', () => {
  it('averages milestone completion into the project', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const id = project.body.data.id;

    for (const percent of [100, 50, 0]) {
      await request(app)
        .post(`/api/projects/${id}/milestones`)
        .set(authHeader(token))
        .send({ name: `Stage ${percent}`, completionPercent: percent });
    }

    const response = await request(app).get(`/api/projects/${id}`).set(authHeader(token));
    // (100 + 50 + 0) / 3 = 50
    expect(response.body.data.progress).toBe(50);
  });

  it('sets a completed milestone to 100% and recomputes', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const id = project.body.data.id;

    const milestone = await request(app)
      .post(`/api/projects/${id}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Design', completionPercent: 20 });

    const updated = await request(app)
      .patch(`/api/projects/${id}/milestones/${milestone.body.data.id}`)
      .set(authHeader(token))
      .send({ status: MilestoneStatus.COMPLETED });

    expect(updated.body.data.completionPercent).toBe(100);
    expect(updated.body.data.completedAt).not.toBeNull();

    const project2 = await request(app).get(`/api/projects/${id}`).set(authHeader(token));
    expect(project2.body.data.progress).toBe(100);
  });

  it('leaves a cancelled milestone out of the average', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const id = project.body.data.id;

    await request(app)
      .post(`/api/projects/${id}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Done', completionPercent: 100 });
    const dropped = await request(app)
      .post(`/api/projects/${id}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Dropped', completionPercent: 0 });

    await request(app)
      .patch(`/api/projects/${id}/milestones/${dropped.body.data.id}`)
      .set(authHeader(token))
      .send({ status: MilestoneStatus.CANCELLED });

    const response = await request(app).get(`/api/projects/${id}`).set(authHeader(token));
    expect(response.body.data.progress).toBe(100);
  });

  it('numbers milestones in the order they are added', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const id = project.body.data.id;

    for (const name of ['Requirements', 'Design', 'Build']) {
      await request(app)
        .post(`/api/projects/${id}/milestones`)
        .set(authHeader(token))
        .send({ name });
    }

    const response = await request(app)
      .get(`/api/projects/${id}/milestones`)
      .set(authHeader(token));

    expect(response.body.data.map((m: { name: string }) => m.name)).toEqual([
      'Requirements',
      'Design',
      'Build',
    ]);
    expect(response.body.data.map((m: { position: number }) => m.position)).toEqual([0, 1, 2]);
  });

  it('refuses to remove a milestone that still has tasks', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const projectId = project.body.data.id;

    const milestone = await request(app)
      .post(`/api/projects/${projectId}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Design' });

    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Wireframes', projectId, milestoneId: milestone.body.data.id });

    const response = await request(app)
      .delete(`/api/projects/${projectId}/milestones/${milestone.body.data.id}`)
      .set(authHeader(token));

    expect(response.status).toBe(409);
  });

  it('flags a milestone past its due date', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const id = project.body.data.id;

    await request(app)
      .post(`/api/projects/${id}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Late stage', dueDate: '2020-01-01' });

    const response = await request(app)
      .get(`/api/projects/${id}/milestones`)
      .set(authHeader(token));

    expect(response.body.data[0].isOverdue).toBe(true);
  });
});

describe('project status and team', () => {
  it('marks a completed project as finished and full', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);

    const response = await request(app)
      .post(`/api/projects/${project.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: ProjectStatus.COMPLETED });

    expect(response.body.data.status).toBe(ProjectStatus.COMPLETED);
    expect(response.body.data.progress).toBe(100);
    expect(response.body.data.completedAt).not.toBeNull();
  });

  it('stops calling a delivered project overdue', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id, { deliveryDate: '2020-01-01' });
    const id = project.body.data.id;

    const before = await request(app).get(`/api/projects/${id}`).set(authHeader(token));
    expect(before.body.data.isOverdue).toBe(true);

    await request(app)
      .post(`/api/projects/${id}/status`)
      .set(authHeader(token))
      .send({ status: ProjectStatus.COMPLETED });

    const after = await request(app).get(`/api/projects/${id}`).set(authHeader(token));
    expect(after.body.data.isOverdue).toBe(false);
  });

  it('adds and removes team members', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const id = project.body.data.id;
    const colleague = await createTestUser(UserRole.EMPLOYEE);

    const added = await request(app)
      .post(`/api/projects/${id}/members`)
      .set(authHeader(token))
      .send({ userId: colleague.id, roleLabel: 'Frontend' });
    expect(added.status).toBe(201);
    expect(added.body.data.members).toHaveLength(2);

    const removed = await request(app)
      .delete(`/api/projects/${id}/members/${colleague.id}`)
      .set(authHeader(token));
    expect(removed.body.data.members).toHaveLength(1);
  });

  it('refuses to add the same person twice', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const colleague = await createTestUser(UserRole.EMPLOYEE);

    await request(app)
      .post(`/api/projects/${project.body.data.id}/members`)
      .set(authHeader(token))
      .send({ userId: colleague.id });
    const second = await request(app)
      .post(`/api/projects/${project.body.data.id}/members`)
      .set(authHeader(token))
      .send({ userId: colleague.id });

    expect(second.status).toBe(409);
  });

  it('refuses to remove the manager from their own project', async () => {
    const { user, token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);

    const response = await request(app)
      .delete(`/api/projects/${project.body.data.id}/members/${user.id}`)
      .set(authHeader(token));

    expect(response.status).toBe(409);
  });

  it('keeps a value-change trail', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id, { value: 800000 });

    await request(app)
      .patch(`/api/projects/${project.body.data.id}`)
      .set(authHeader(token))
      .send({ value: 900000, valueChangeReason: 'Extra scope agreed' });

    const history = await prisma.pricingHistory.findMany({
      where: { entityId: project.body.data.id },
    });
    expect(history).toHaveLength(1);
    expect(Number(history[0]!.previousValue)).toBe(800000);
    expect(history[0]!.reason).toBe('Extra scope agreed');
  });

  it('hides a deleted project’s tasks along with it', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);
    const token = session.accessToken;
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);
    const projectId = project.body.data.id;

    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Orphan candidate', projectId });

    await request(app).delete(`/api/projects/${projectId}`).set(authHeader(token));

    const tasks = await request(app).get('/api/tasks').set(authHeader(token));
    expect(tasks.body.data).toHaveLength(0);
  });
});

describe('tasks: lateness is derived, never a status', () => {
  it('reports an in-progress task as overdue without changing its status', async () => {
    const { token } = await managerSession();

    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Create homepage', dueAt: '2020-01-01T12:00:00.000Z' });

    await request(app)
      .post(`/api/tasks/${task.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: TaskStatus.IN_PROGRESS });

    const response = await request(app)
      .get(`/api/tasks/${task.body.data.id}`)
      .set(authHeader(token));

    // The two facts are independent, exactly as the brief requires.
    expect(response.body.data.status).toBe(TaskStatus.IN_PROGRESS);
    expect(response.body.data.isOverdue).toBe(true);
  });

  it('keeps a blocked task blocked when it goes late', async () => {
    const { token } = await managerSession();
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Waiting on assets', dueAt: '2020-01-01T12:00:00.000Z' });

    await request(app)
      .post(`/api/tasks/${task.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: TaskStatus.BLOCKED });

    const response = await request(app)
      .get(`/api/tasks/${task.body.data.id}`)
      .set(authHeader(token));

    expect(response.body.data.status).toBe(TaskStatus.BLOCKED);
    expect(response.body.data.isOverdue).toBe(true);
  });

  it('stops calling a completed task overdue', async () => {
    const { token } = await managerSession();
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Done late', dueAt: '2020-01-01T12:00:00.000Z' });

    await request(app)
      .post(`/api/tasks/${task.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: TaskStatus.COMPLETED, actualHours: 6 });

    const response = await request(app)
      .get(`/api/tasks/${task.body.data.id}`)
      .set(authHeader(token));

    expect(response.body.data.isOverdue).toBe(false);
    expect(response.body.data.completedAt).not.toBeNull();
    expect(response.body.data.actualHours).toBe(6);
  });

  it('never stores OVERDUE as a status', async () => {
    const { token } = await managerSession();
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Try it on', dueAt: '2020-01-01T12:00:00.000Z' });

    const response = await request(app)
      .post(`/api/tasks/${task.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: 'OVERDUE' });

    expect(response.status).toBe(400);
  });

  it('filters by overdue', async () => {
    const { token } = await managerSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Late', dueAt: '2020-01-01T12:00:00.000Z' });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Fine', dueAt: '2099-01-01T12:00:00.000Z' });

    const response = await request(app)
      .get('/api/tasks')
      .query({ overdue: 'true' })
      .set(authHeader(token));

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Late');
  });
});

describe('tasks', () => {
  it('inherits the client from its project', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const project = await makeProject(token, client.id);

    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Build the header', projectId: project.body.data.id });

    expect(task.body.data.client.id).toBe(client.id);
  });

  it('refuses a milestone that belongs to another project', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    const first = await makeProject(token, client.id, { name: 'First' });
    const second = await makeProject(token, client.id, { name: 'Second' });

    const milestone = await request(app)
      .post(`/api/projects/${first.body.data.id}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Design' });

    const response = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({
        title: 'Wrong project',
        projectId: second.body.data.id,
        milestoneId: milestone.body.data.id,
      });

    expect(response.status).toBe(422);
  });

  it('refuses a milestone with no project', async () => {
    const { token } = await managerSession();

    const response = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Floating', milestoneId: '11111111-1111-4111-8111-111111111111' });

    expect(response.status).toBe(400);
  });

  it('shows an employee only their own work', async () => {
    const manager = await managerSession();
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    await request(app)
      .post('/api/tasks')
      .set(authHeader(manager.token))
      .send({ title: 'Somebody else’s' });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(manager.token))
      .send({ title: 'Theirs', assigneeId: employee.id });

    const response = await request(app).get('/api/tasks').set(authHeader(session.accessToken));

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Theirs');
  });

  it('lets a project member see the work around theirs', async () => {
    const manager = await managerSession();
    const client = await clientViaAdmin();
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const project = await makeProject(manager.token, client.id, { memberIds: [employee.id] });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(manager.token))
      .send({ title: 'Assigned to nobody', projectId: project.body.data.id });

    const response = await request(app).get('/api/tasks').set(authHeader(session.accessToken));
    expect(response.body.data).toHaveLength(1);
  });

  it('records assignment', async () => {
    const { token } = await managerSession();
    const colleague = await createTestUser(UserRole.EMPLOYEE);
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Needs an owner' });

    const response = await request(app)
      .post(`/api/tasks/${task.body.data.id}/assign`)
      .set(authHeader(token))
      .send({ assigneeId: colleague.id });

    expect(response.body.data.assignee.id).toBe(colleague.id);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: task.body.data.id, action: 'ASSIGNED' },
    });
    expect(audits).toHaveLength(1);
  });

  it('holds a discussion on the task', async () => {
    const { token } = await managerSession();
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Discuss me' });

    await request(app)
      .post(`/api/tasks/${task.body.data.id}/comments`)
      .set(authHeader(token))
      .send({ body: 'Blocked on the copy deck.' });

    const comments = await request(app)
      .get(`/api/tasks/${task.body.data.id}/comments`)
      .set(authHeader(token));

    expect(comments.body.data).toHaveLength(1);
    expect(comments.body.data[0].body).toBe('Blocked on the copy deck.');
  });

  it('counts what needs attention', async () => {
    const { token } = await managerSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Late', dueAt: '2020-01-01T12:00:00.000Z' });
    await request(app).post('/api/tasks').set(authHeader(token)).send({ title: 'No deadline' });

    const response = await request(app).get('/api/tasks/summary').set(authHeader(token));

    expect(response.body.data.total).toBe(2);
    expect(response.body.data.open).toBe(2);
    expect(response.body.data.overdue).toBe(1);
    expect(response.body.data.byStatus.TODO).toBe(2);
  });

  it('sorts tasks with no deadline last', async () => {
    const { token } = await managerSession();
    await request(app).post('/api/tasks').set(authHeader(token)).send({ title: 'Undated' });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Dated', dueAt: '2026-09-01T12:00:00.000Z' });

    const response = await request(app)
      .get('/api/tasks')
      .query({ sortBy: 'dueAt', sortOrder: 'asc' })
      .set(authHeader(token));

    expect(response.body.data.map((task: { title: string }) => task.title)).toEqual([
      'Dated',
      'Undated',
    ]);
  });
});

describe('search casing', () => {
  it('matches a project search term regardless of case', async () => {
    const { token } = await managerSession();
    const client = await clientViaAdmin();
    await makeProject(token, client.id, { name: 'Harbour Portal' });

    // MySQL's utf8mb4_unicode_ci matched this for free; Postgres does not.
    const response = await request(app)
      .get('/api/projects?search=harbour')
      .set(authHeader(token))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Harbour Portal');
  });
});
