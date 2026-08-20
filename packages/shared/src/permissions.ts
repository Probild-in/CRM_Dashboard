import { UserRole } from './enums.js';

/**
 * Permission catalogue.
 *
 * Naming: `<resource>:<action>`. A `:all` suffix widens an otherwise
 * ownership-scoped read (e.g. a SALES rep reads their own leads, a manager
 * reads every lead). The API is the sole enforcement point — the web client
 * reuses this map only to hide controls the user could not use anyway.
 */
export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard:read',

  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_DELETE: 'user:delete',

  LEAD_READ: 'lead:read',
  LEAD_READ_ALL: 'lead:read:all',
  LEAD_WRITE: 'lead:write',
  LEAD_DELETE: 'lead:delete',
  LEAD_ASSIGN: 'lead:assign',
  LEAD_CONVERT: 'lead:convert',

  CLIENT_READ: 'client:read',
  CLIENT_WRITE: 'client:write',
  CLIENT_DELETE: 'client:delete',

  DEAL_READ: 'deal:read',
  DEAL_WRITE: 'deal:write',
  DEAL_DELETE: 'deal:delete',

  QUOTATION_READ: 'quotation:read',
  QUOTATION_WRITE: 'quotation:write',
  QUOTATION_DELETE: 'quotation:delete',

  PROJECT_READ: 'project:read',
  PROJECT_READ_ALL: 'project:read:all',
  PROJECT_WRITE: 'project:write',
  PROJECT_DELETE: 'project:delete',

  MILESTONE_WRITE: 'milestone:write',

  TASK_READ: 'task:read',
  TASK_READ_ALL: 'task:read:all',
  TASK_WRITE: 'task:write',
  TASK_DELETE: 'task:delete',
  TASK_ASSIGN: 'task:assign',

  MEETING_READ: 'meeting:read',
  MEETING_WRITE: 'meeting:write',
  MEETING_DELETE: 'meeting:delete',

  PAYMENT_READ: 'payment:read',
  PAYMENT_WRITE: 'payment:write',
  PAYMENT_DELETE: 'payment:delete',

  DOCUMENT_READ: 'document:read',
  DOCUMENT_WRITE: 'document:write',
  DOCUMENT_DELETE: 'document:delete',

  REPORT_READ: 'report:read',
  AUDIT_READ: 'audit:read',

  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const SALES_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_READ,
  PERMISSIONS.USER_READ,
  PERMISSIONS.LEAD_READ,
  PERMISSIONS.LEAD_READ_ALL,
  PERMISSIONS.LEAD_WRITE,
  PERMISSIONS.LEAD_ASSIGN,
  PERMISSIONS.LEAD_CONVERT,
  PERMISSIONS.CLIENT_READ,
  PERMISSIONS.CLIENT_WRITE,
  PERMISSIONS.DEAL_READ,
  PERMISSIONS.DEAL_WRITE,
  PERMISSIONS.QUOTATION_READ,
  PERMISSIONS.QUOTATION_WRITE,
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.TASK_READ,
  PERMISSIONS.TASK_WRITE,
  PERMISSIONS.MEETING_READ,
  PERMISSIONS.MEETING_WRITE,
  PERMISSIONS.MEETING_DELETE,
  PERMISSIONS.PAYMENT_READ,
  PERMISSIONS.DOCUMENT_READ,
  PERMISSIONS.DOCUMENT_WRITE,
  PERMISSIONS.REPORT_READ,
];

const PROJECT_MANAGER_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_READ,
  PERMISSIONS.USER_READ,
  PERMISSIONS.LEAD_READ,
  PERMISSIONS.CLIENT_READ,
  PERMISSIONS.DEAL_READ,
  PERMISSIONS.QUOTATION_READ,
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_READ_ALL,
  PERMISSIONS.PROJECT_WRITE,
  PERMISSIONS.MILESTONE_WRITE,
  PERMISSIONS.TASK_READ,
  PERMISSIONS.TASK_READ_ALL,
  PERMISSIONS.TASK_WRITE,
  PERMISSIONS.TASK_DELETE,
  PERMISSIONS.TASK_ASSIGN,
  PERMISSIONS.MEETING_READ,
  PERMISSIONS.MEETING_WRITE,
  PERMISSIONS.MEETING_DELETE,
  PERMISSIONS.PAYMENT_READ,
  PERMISSIONS.DOCUMENT_READ,
  PERMISSIONS.DOCUMENT_WRITE,
  PERMISSIONS.REPORT_READ,
];

const EMPLOYEE_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_READ,
  PERMISSIONS.USER_READ,
  PERMISSIONS.CLIENT_READ,
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.TASK_READ,
  PERMISSIONS.TASK_WRITE,
  PERMISSIONS.MEETING_READ,
  PERMISSIONS.MEETING_WRITE,
  PERMISSIONS.DOCUMENT_READ,
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: ALL_PERMISSIONS,
  [UserRole.SALES]: SALES_PERMISSIONS,
  [UserRole.PROJECT_MANAGER]: PROJECT_MANAGER_PERMISSIONS,
  [UserRole.EMPLOYEE]: EMPLOYEE_PERMISSIONS,
};

export function permissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** True when the role may read records it does not own, for the given resource. */
export function canReadAll(role: UserRole, resource: 'lead' | 'project' | 'task'): boolean {
  const map = {
    lead: PERMISSIONS.LEAD_READ_ALL,
    project: PERMISSIONS.PROJECT_READ_ALL,
    task: PERMISSIONS.TASK_READ_ALL,
  } as const;
  return roleHasPermission(role, map[resource]);
}
