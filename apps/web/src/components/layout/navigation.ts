import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  FileStack,
  FileText,
  FolderKanban,
  Gauge,
  History,
  KanbanSquare,
  ListChecks,
  Settings,
  Target,
  Users,
  Wallet,
} from 'lucide-react';
import { PERMISSIONS, type Permission } from '@probild/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: typeof Gauge;
  permission?: Permission;
}

export interface NavGroup {
  /** Groups follow the business lifecycle, not the alphabet. */
  label: string | null;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: null,
    items: [{ label: 'Dashboard', to: '/', icon: Gauge, permission: PERMISSIONS.DASHBOARD_READ }],
  },
  {
    label: 'Pipeline',
    items: [
      { label: 'Leads', to: '/leads', icon: Target, permission: PERMISSIONS.LEAD_READ },
      { label: 'Pipeline', to: '/pipeline', icon: KanbanSquare, permission: PERMISSIONS.LEAD_READ },
      { label: 'Quotations', to: '/quotations', icon: FileText, permission: PERMISSIONS.QUOTATION_READ },
      { label: 'Clients', to: '/clients', icon: Building2, permission: PERMISSIONS.CLIENT_READ },
      {
        label: 'Documents',
        to: '/documents',
        icon: FileStack,
        permission: PERMISSIONS.DOCUMENT_READ,
      },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { label: 'Projects', to: '/projects', icon: FolderKanban, permission: PERMISSIONS.PROJECT_READ },
      { label: 'Tasks', to: '/tasks', icon: ListChecks, permission: PERMISSIONS.TASK_READ },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays, permission: PERMISSIONS.MEETING_READ },
    ],
  },
  {
    label: 'Money',
    items: [
      { label: 'Payments', to: '/payments', icon: Wallet, permission: PERMISSIONS.PAYMENT_READ },
      { label: 'Reports', to: '/reports', icon: ClipboardList, permission: PERMISSIONS.REPORT_READ },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Notifications', to: '/notifications', icon: Bell },
      { label: 'Team', to: '/team', icon: Users, permission: PERMISSIONS.USER_READ },
      { label: 'Audit log', to: '/audit', icon: History, permission: PERMISSIONS.AUDIT_READ },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];
