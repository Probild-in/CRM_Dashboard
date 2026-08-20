import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { leadsRouter } from '../modules/leads/leads.routes.js';
import { clientsRouter } from '../modules/clients/clients.routes.js';
import { dealsRouter } from '../modules/deals/deals.routes.js';
import { quotationsRouter } from '../modules/quotations/quotations.routes.js';
import { projectsRouter } from '../modules/projects/projects.routes.js';
import { tasksRouter } from '../modules/tasks/tasks.routes.js';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { meetingsRouter } from '../modules/meetings/meetings.routes.js';
import { calendarRouter } from '../modules/calendar/calendar.routes.js';
import { notificationsRouter } from '../modules/notifications/notifications.routes.js';
import { automationRouter } from '../modules/automation/automation.routes.js';
import { paymentsRouter } from '../modules/payments/payments.routes.js';
import { reportsRouter } from '../modules/reports/reports.routes.js';
import { documentsRouter } from '../modules/documents/documents.routes.js';
import { servicesRouter } from '../modules/services/services.routes.js';
import { searchRouter } from '../modules/search/search.routes.js';
import { auditRouter } from '../modules/audit/audit.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';

/**
 * Every module mounts one router here. Feature phases add their routes to this
 * table and nowhere else.
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/leads', leadsRouter);
apiRouter.use('/clients', clientsRouter);
apiRouter.use('/deals', dealsRouter);
apiRouter.use('/quotations', quotationsRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/tasks', tasksRouter);
apiRouter.use('/meetings', meetingsRouter);
apiRouter.use('/calendar', calendarRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/automation', automationRouter);
apiRouter.use('/services', servicesRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/audit', auditRouter);
