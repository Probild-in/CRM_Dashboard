import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Pencil, Plus } from 'lucide-react';
import { ClientStatus, PERMISSIONS } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { CLIENT_STATUS_TONES } from '@/components/ui/tones';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination, TableWrap, Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { ClientFormModal } from '@/features/clients/ClientFormModal';
import { useClients } from '@/features/clients/api';
import type { Client } from '@/features/clients/types';
import { toMessage } from '@/lib/api';
import { formatDate, humanise } from '@/lib/utils';

export default function ClientsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.CLIENT_WRITE);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | ''>('');
  const [manager, setManager] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const team = useUsers({ page: 1, pageSize: 100 });
  const query = useClients({
    page,
    pageSize: 20,
    search,
    status,
    accountManagerId: manager || undefined,
  });

  const hasFilters = Boolean(search || status || manager);

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Clients"
        description="Everyone Probild works with, and the whole history behind each one."
        action={
          canWrite ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />
              Add client
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Company, email or reference"
            aria-label="Search clients"
            className="h-9 max-w-xs"
          />
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ClientStatus | '');
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 w-auto"
          >
            <option value="">All statuses</option>
            {Object.values(ClientStatus).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={manager}
            onChange={(event) => {
              setManager(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by account manager"
            className="h-9 w-auto"
          >
            <option value="">All account managers</option>
            {team.data?.items.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
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
            icon={<Building2 aria-hidden className="size-4.5" />}
            title={hasFilters ? 'No clients match those filters' : 'No clients yet'}
            description={
              hasFilters
                ? 'Clear the filters to see everyone.'
                : 'Win a lead and convert it, or add a client you already work with.'
            }
            action={
              canWrite && !hasFilters ? (
                <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                  <Plus aria-hidden className="size-4" />
                  Add client
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Client</Th>
                  <Th>Status</Th>
                  <Th>Account manager</Th>
                  <Th>Bills in</Th>
                  <Th>Since</Th>
                  {canWrite ? <Th align="right">Actions</Th> : null}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((client) => (
                  <tr key={client.id} className="group transition-colors hover:bg-panel-muted">
                    <Td>
                      <Link to={`/clients/${client.id}`} className="block min-w-0">
                        <span className="block truncate text-[0.8125rem] font-medium text-ink group-hover:text-accent">
                          {client.companyName}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-faint">
                          {client.reference}
                          {client.industry ? ` · ${client.industry}` : ''}
                          {client.city ? ` · ${client.city}` : ''}
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={CLIENT_STATUS_TONES[client.status] ?? 'neutral'}>
                        {humanise(client.status)}
                      </Badge>
                    </Td>
                    <Td className="text-[0.8125rem]">
                      {client.accountManager
                        ? `${client.accountManager.firstName} ${client.accountManager.lastName}`
                        : 'Unassigned'}
                    </Td>
                    <Td className="font-mono text-[0.8125rem]">{client.defaultCurrency}</Td>
                    <Td className="tabular font-mono text-xs">{formatDate(client.onboardedAt)}</Td>
                    {canWrite ? (
                      <Td align="right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit ${client.companyName}`}
                          onClick={() => {
                            setEditing(client);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil aria-hidden className="size-4" />
                        </Button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="clients" />
          </>
        )}
      </Panel>

      <ClientFormModal open={formOpen} onClose={() => setFormOpen(false)} client={editing} />
    </>
  );
}
