import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PERMISSIONS } from '@probild/shared';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth, RequirePermission } from '@/features/auth/RequireAuth';
import { LoadingState } from '@/components/ui/States';

const SignInPage = lazy(() => import('@/pages/SignInPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const LeadsPage = lazy(() => import('@/pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('@/pages/LeadDetailPage'));
const PipelinePage = lazy(() => import('@/pages/PipelinePage'));
const ClientsPage = lazy(() => import('@/pages/ClientsPage'));
const ClientDetailPage = lazy(() => import('@/pages/ClientDetailPage'));
const QuotationsPage = lazy(() => import('@/pages/QuotationsPage'));
const QuotationDetailPage = lazy(() => import('@/pages/QuotationDetailPage'));
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('@/pages/ProjectDetailPage'));
const TasksPage = lazy(() => import('@/pages/TasksPage'));
const CalendarPage = lazy(() => import('@/pages/CalendarPage'));
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage'));
const PaymentsPage = lazy(() => import('@/pages/PaymentsPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const TeamPage = lazy(() => import('@/pages/TeamPage'));
const AuditPage = lazy(() => import('@/pages/AuditPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export default function App() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />

            <Route element={<RequirePermission permission={PERMISSIONS.LEAD_READ} />}>
              <Route path="leads" element={<LeadsPage />} />
              <Route path="leads/:id" element={<LeadDetailPage />} />
              <Route path="pipeline" element={<PipelinePage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.CLIENT_READ} />}>
              <Route path="clients" element={<ClientsPage />} />
              <Route path="clients/:id" element={<ClientDetailPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.QUOTATION_READ} />}>
              <Route path="quotations" element={<QuotationsPage />} />
              <Route path="quotations/:id" element={<QuotationDetailPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.PROJECT_READ} />}>
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.TASK_READ} />}>
              <Route path="tasks" element={<TasksPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.MEETING_READ} />}>
              <Route path="calendar" element={<CalendarPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.DOCUMENT_READ} />}>
              <Route path="documents" element={<DocumentsPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.PAYMENT_READ} />}>
              <Route path="payments" element={<PaymentsPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.REPORT_READ} />}>
              <Route path="reports" element={<ReportsPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.USER_READ} />}>
              <Route path="team" element={<TeamPage />} />
            </Route>

            <Route element={<RequirePermission permission={PERMISSIONS.AUDIT_READ} />}>
              <Route path="audit" element={<AuditPage />} />
            </Route>

            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="404" element={<NotFoundPage />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
