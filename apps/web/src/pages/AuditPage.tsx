import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { AuditAction, EntityType } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Select } from '@/components/ui/Field';
import { Badge, type Tone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination, TableWrap, Td, Th } from '@/components/ui/Table';
import { apiGetPaginated, toMessage } from '@/lib/api';
import { formatDateTime, humanise } from '@/lib/utils';

interface AuditRow {
  id: string;
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  summary: string | null;
  createdAt: string;
  ipAddress: string | null;
  user: { id: string; firstName: string; lastName: string; email: string } | null;
}

const ACTION_TONES: Partial<Record<AuditAction, Tone>> = {
  CREATED: 'success',
  DELETED: 'danger',
  LOGIN_FAILED: 'danger',
  STATUS_CHANGED: 'warning',
  VALUE_CHANGED: 'warning',
  PASSWORD_CHANGED: 'warning',
  LOGGED_IN: 'accent',
};

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<AuditAction | ''>('');
  const [entityType, setEntityType] = useState<EntityType | ''>('');

  const query = useQuery({
    queryKey: ['audit', page, action, entityType],
    queryFn: () =>
      apiGetPaginated<AuditRow>('/audit', {
        params: {
          page,
          pageSize: 25,
          ...(action ? { action } : {}),
          ...(entityType ? { entityType } : {}),
        },
      }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        description="Who changed what, and when. Every record is written once and never edited."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value as AuditAction | '');
              setPage(1);
            }}
            aria-label="Filter by action"
            className="h-9 w-auto"
          >
            <option value="">All actions</option>
            {Object.values(AuditAction).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value as EntityType | '');
              setPage(1);
            }}
            aria-label="Filter by record type"
            className="h-9 w-auto"
          >
            <option value="">All record types</option>
            {Object.values(EntityType).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
        </div>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={4} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<History aria-hidden className="size-4.5" />}
            title="No activity recorded yet"
            description="Sign-ins and record changes will be listed here as they happen."
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>What changed</Th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-panel-muted">
                    <Td className="tabular font-mono text-xs whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </Td>
                    <Td>
                      <span className="text-[0.8125rem] text-ink">
                        {entry.user ? `${entry.user.firstName} ${entry.user.lastName}` : 'System'}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={ACTION_TONES[entry.action] ?? 'neutral'}>
                        {humanise(entry.action)}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-[0.8125rem] text-ink-soft">
                        {entry.summary ?? humanise(entry.entityType)}
                      </span>
                      <span className="ml-2 font-mono text-[0.625rem] text-ink-faint">
                        {entry.entityType}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="entries" />
          </>
        )}
      </Panel>
    </>
  );
}
