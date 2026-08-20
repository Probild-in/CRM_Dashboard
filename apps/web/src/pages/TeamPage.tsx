import { useState } from 'react';
import { KeyRound, Pencil, Plus, UserMinus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, UserRole, UserStatus, type AuthUser } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { ROLE_TONES, STATUS_TONES } from '@/components/ui/tones';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination, TableWrap, Td, Th } from '@/components/ui/Table';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthContext';
import { UserFormModal } from '@/features/users/UserFormModal';
import { useDeactivateUser, useResetUserPassword, useUsers } from '@/features/users/api';
import { formatDateTime, humanise, initials } from '@/lib/utils';
import { toMessage } from '@/lib/api';

export default function TeamPage() {
  const { can, user: currentUser } = useAuth();
  const canManage = can(PERMISSIONS.USER_WRITE);
  const canDelete = can(PERMISSIONS.USER_DELETE);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [deactivating, setDeactivating] = useState<AuthUser | null>(null);
  const [resetting, setResetting] = useState<AuthUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const query = useUsers({ page, pageSize: 20, search, role, status });
  const deactivateUser = useDeactivateUser();
  const resetPassword = useResetUserPassword();

  const onFilterChange = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Team"
        description="Everyone who can sign in to Probild, and what each of them is allowed to do."
        action={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />
              Add member
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <Input
            type="search"
            value={search}
            onChange={(event) => onFilterChange(setSearch)(event.target.value)}
            placeholder="Search by name, email or job title"
            aria-label="Search team"
            className="h-9 max-w-xs"
          />
          <Select
            value={role}
            onChange={(event) => onFilterChange(setRole)(event.target.value as UserRole | '')}
            aria-label="Filter by role"
            className="h-9 w-auto"
          >
            <option value="">All roles</option>
            {Object.values(UserRole).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(event) => onFilterChange(setStatus)(event.target.value as UserStatus | '')}
            aria-label="Filter by status"
            className="h-9 w-auto"
          >
            <option value="">All statuses</option>
            {Object.values(UserStatus).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
        </div>

        {query.isPending ? (
          <TableSkeleton rows={6} columns={5} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<Users aria-hidden className="size-4.5" />}
            title={search || role || status ? 'No one matches those filters' : 'No team members yet'}
            description={
              search || role || status
                ? 'Clear the filters to see everyone.'
                : 'Add the first member so they can start working in Probild.'
            }
            action={
              canManage && !search && !role && !status ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus aria-hidden className="size-4" />
                  Add member
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Last signed in</Th>
                  {canManage ? <Th align="right">Actions</Th> : null}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((member) => (
                  <tr key={member.id} className="transition-colors hover:bg-panel-muted">
                    <Td>
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded bg-neutral-soft font-mono text-[0.6875rem] font-semibold text-ink-soft">
                          {initials(member.firstName, member.lastName)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[0.8125rem] font-medium text-ink">
                            {member.fullName}
                            {member.id === currentUser?.id ? (
                              <span className="ml-1.5 font-mono text-[0.625rem] text-ink-faint">YOU</span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-ink-faint">
                            {member.designation ? `${member.designation} · ` : ''}
                            {member.email}
                          </span>
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={ROLE_TONES[member.role] ?? 'neutral'}>{humanise(member.role)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONES[member.status] ?? 'neutral'}>
                        {humanise(member.status)}
                      </Badge>
                    </Td>
                    <Td className="tabular font-mono text-xs">
                      {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'Never'}
                    </Td>
                    {canManage ? (
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${member.fullName}`}
                            onClick={() => {
                              setEditing(member);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil aria-hidden className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Reset password for ${member.fullName}`}
                            onClick={() => {
                              setNewPassword('');
                              setResetting(member);
                            }}
                          >
                            <KeyRound aria-hidden className="size-4" />
                          </Button>
                          {canDelete && member.id !== currentUser?.id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Deactivate ${member.fullName}`}
                              onClick={() => setDeactivating(member)}
                            >
                              <UserMinus aria-hidden className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="members" />
          </>
        )}
      </Panel>

      <UserFormModal open={formOpen} onClose={() => setFormOpen(false)} user={editing} />

      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        loading={deactivateUser.isPending}
        destructive
        title="Deactivate this member?"
        confirmLabel="Deactivate"
        message={
          deactivating
            ? `${deactivating.fullName} will be signed out and will not be able to sign in again. Their leads, projects and history stay exactly where they are.`
            : ''
        }
        onConfirm={async () => {
          if (!deactivating) return;
          try {
            await deactivateUser.mutateAsync(deactivating.id);
            toast.success(`Deactivated ${deactivating.fullName}`);
            setDeactivating(null);
          } catch (error) {
            toast.error(toMessage(error));
          }
        }}
      />

      <Modal
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title="Set a new password"
        description={
          resetting
            ? `${resetting.fullName} will be signed out everywhere and will need this password to sign back in.`
            : ''
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetting(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={resetPassword.isPending}
              onClick={async () => {
                if (!resetting) return;
                try {
                  await resetPassword.mutateAsync({ id: resetting.id, newPassword });
                  toast.success(`Password set for ${resetting.fullName}`);
                  setResetting(null);
                } catch (error) {
                  toast.error(toMessage(error));
                }
              }}
            >
              Set password
            </Button>
          </>
        }
      >
        <Input
          type="text"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="At least 8 characters, with a number and a symbol"
          aria-label="New password"
        />
      </Modal>
    </>
  );
}
