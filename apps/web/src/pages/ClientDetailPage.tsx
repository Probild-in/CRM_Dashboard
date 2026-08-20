import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  FilePlus2,
  FolderPlus,
  Mail,
  Pencil,
  Phone,
  Star,
} from 'lucide-react';
import { PERMISSIONS } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  CLIENT_STATUS_TONES,
  DEAL_STAGE_TONES,
  PROJECT_STATUS_TONES,
  QUOTATION_STATUS_TONES,
  TASK_STATUS_TONES,
} from '@/components/ui/tones';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { TableWrap, Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/AuthContext';
import { ClientFormModal } from '@/features/clients/ClientFormModal';
import { QuotationBuilder } from '@/features/quotations/QuotationBuilder';
import { ProjectFormModal } from '@/features/projects/ProjectFormModal';
import { DocumentsPanel } from '@/features/documents/DocumentsPanel';
import { useClientOverview } from '@/features/clients/api';
import { toMessage } from '@/lib/api';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyTotals as money,
  humanise,
} from '@/lib/utils';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.CLIENT_WRITE);
  const canQuote = can(PERMISSIONS.QUOTATION_WRITE);
  const canProject = can(PERMISSIONS.PROJECT_WRITE);

  const [tab, setTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const overview = useClientOverview(id);

  if (overview.isPending) return <LoadingState label="Loading client" />;
  if (overview.isError) {
    return (
      <Panel>
        <ErrorState
          title="This client did not load"
          message={toMessage(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      </Panel>
    );
  }

  const {
    client,
    stats,
    contacts,
    deals,
    quotations,
    projects,
    tasks,
    meetings,
    payments,
    documents,
    originLeads,
    activity,
  } =
    overview.data;

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'deals', label: 'Deals', count: deals.length },
    { key: 'quotations', label: 'Quotations', count: quotations.length },
    { key: 'projects', label: 'Projects', count: projects.length },
    { key: 'tasks', label: 'Tasks', count: tasks.length },
    { key: 'meetings', label: 'Meetings', count: meetings.length },
    { key: 'payments', label: 'Payments', count: payments.length },
    { key: 'documents', label: 'Documents', count: documents.length },
    { key: 'contacts', label: 'Contacts', count: contacts.length },
    { key: 'activity', label: 'Activity', count: activity.length },
  ];

  return (
    <>
      <Link
        to="/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-faint hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All clients
      </Link>

      <PageHeader
        eyebrow={client.reference}
        title={client.companyName}
        description={
          [client.industry, client.city, client.country].filter(Boolean).join(' · ') || undefined
        }
        action={
          <div className="flex flex-wrap gap-2">
            {canProject ? (
              <Button variant="secondary" onClick={() => setProjectOpen(true)}>
                <FolderPlus aria-hidden className="size-4" />
                New project
              </Button>
            ) : null}
            {canQuote ? (
              <Button variant="secondary" onClick={() => setQuoteOpen(true)}>
                <FilePlus2 aria-hidden className="size-4" />
                New quotation
              </Button>
            ) : null}
            {canWrite ? (
              <Button variant="primary" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden className="size-4" />
                Edit
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={CLIENT_STATUS_TONES[client.status] ?? 'neutral'}>
          {humanise(client.status)}
        </Badge>
        <Badge>Bills in {client.defaultCurrency}</Badge>
        {client.accountManager ? (
          <Badge tone="accent">
            {client.accountManager.firstName} {client.accountManager.lastName}
          </Badge>
        ) : null}
      </div>

      <div className="mb-6 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Won business" value={money(stats.wonValue)} hint={`${stats.dealCount} deals`} />
        <Metric label="Open deals" value={money(stats.openValue)} hint={`${stats.openDealCount} open`} />
        <Metric
          label="Active projects"
          value={String(stats.activeProjectCount)}
          hint={`${stats.projectCount} in total`}
        />
        <Metric label="Outstanding" value={money(stats.outstanding)} hint={`${money(stats.received)} received`} />
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel active={tab} tabKey="overview">
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader eyebrow="Contact" title="How to reach them" />
            <PanelBody className="flex flex-col gap-3">
              <Row label="Email">
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <Mail aria-hidden className="size-3.5" />
                    {client.email}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Phone">
                {client.phone ? (
                  <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <Phone aria-hidden className="size-3.5" />
                    {client.phone}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="WhatsApp">{client.whatsapp ?? '—'}</Row>
              <Row label="Website">
                {client.website ? (
                  <a
                    href={client.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-accent"
                  >
                    Visit
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Address">
                {[client.addressLine, client.city, client.postalCode, client.country]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </Row>
              <Row label="GST / Tax number">{client.taxId ?? '—'}</Row>
              <Row label="Client since">{formatDate(client.onboardedAt)}</Row>
            </PanelBody>
          </Panel>

          <div className="flex flex-col gap-5">
            {originLeads.length > 0 ? (
              <Panel>
                <PanelHeader eyebrow="Where they came from" title="Original lead" />
                <PanelBody className="flex flex-col gap-2">
                  {originLeads.map((lead) => (
                    <Link
                      key={lead.id}
                      to={`/leads/${lead.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-line px-3.5 py-2.5 hover:border-line-strong"
                    >
                      <span>
                        <span className="block text-[0.8125rem] font-medium text-ink">
                          {lead.companyName}
                        </span>
                        <span className="block font-mono text-[0.625rem] text-ink-faint">
                          {lead.reference} · {humanise(lead.source)}
                        </span>
                      </span>
                      <span className="font-mono text-[0.6875rem] text-ink-faint">
                        Won {formatDate(lead.convertedAt)}
                      </span>
                    </Link>
                  ))}
                </PanelBody>
              </Panel>
            ) : null}

            {client.notes ? (
              <Panel>
                <PanelHeader eyebrow="Context" title="Notes" />
                <PanelBody>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
                    {client.notes}
                  </p>
                </PanelBody>
              </Panel>
            ) : null}
          </div>
        </div>
      </TabPanel>

      <TabPanel active={tab} tabKey="deals">
        <Panel>
          {deals.length === 0 ? (
            <EmptyState title="No deals yet" description="Deals opened for this client appear here." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Deal</Th>
                  <Th>Stage</Th>
                  <Th>Owner</Th>
                  <Th align="right">Value</Th>
                  <Th>Closed</Th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id} className="hover:bg-panel-muted">
                    <Td>
                      <span className="block text-[0.8125rem] font-medium text-ink">{deal.title}</span>
                      <span className="block font-mono text-[0.625rem] text-ink-faint">
                        {deal.reference}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={DEAL_STAGE_TONES[deal.stage] ?? 'neutral'}>
                        {humanise(deal.stage)}
                      </Badge>
                    </Td>
                    <Td className="text-[0.8125rem]">
                      {deal.owner ? `${deal.owner.firstName} ${deal.owner.lastName}` : '—'}
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem]">
                      {formatMoney(deal.value, deal.currency)}
                    </Td>
                    <Td className="tabular font-mono text-xs">{formatDate(deal.closedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="quotations">
        <Panel>
          {quotations.length === 0 ? (
            <EmptyState
              title="No quotations yet"
              description="Priced proposals sent to this client will be listed here."
              action={
                canQuote ? (
                  <Button variant="primary" size="sm" onClick={() => setQuoteOpen(true)}>
                    <FilePlus2 aria-hidden className="size-4" />
                    New quotation
                  </Button>
                ) : null
              }
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Quotation</Th>
                  <Th>Status</Th>
                  <Th align="right">Total</Th>
                  <Th>Issued</Th>
                  <Th>Valid until</Th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((quotation) => (
                  <tr key={quotation.id} className="group hover:bg-panel-muted">
                    <Td>
                      <Link to={`/quotations/${quotation.id}`}>
                        <span className="block text-[0.8125rem] font-medium text-ink group-hover:text-accent">
                          {quotation.title}
                        </span>
                        <span className="block font-mono text-[0.625rem] text-ink-faint">
                          {quotation.reference}
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={QUOTATION_STATUS_TONES[quotation.status] ?? 'neutral'}>
                        {humanise(quotation.status)}
                      </Badge>
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem]">
                      {formatMoney(quotation.total, quotation.currency)}
                    </Td>
                    <Td className="tabular font-mono text-xs">{formatDate(quotation.issueDate)}</Td>
                    <Td className="tabular font-mono text-xs">{formatDate(quotation.validUntil)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="projects">
        <Panel>
          {projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Start one from a won deal, and delivery is tracked from there."
              action={
                canProject ? (
                  <Button variant="primary" size="sm" onClick={() => setProjectOpen(true)}>
                    <FolderPlus aria-hidden className="size-4" />
                    New project
                  </Button>
                ) : null
              }
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Status</Th>
                  <Th className="w-40">Progress</Th>
                  <Th align="right">Value</Th>
                  <Th>Delivery</Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="group hover:bg-panel-muted">
                    <Td>
                      <Link to={`/projects/${project.id}`}>
                        <span className="block text-[0.8125rem] font-medium text-ink group-hover:text-accent">
                          {project.name}
                        </span>
                        <span className="block font-mono text-[0.625rem] text-ink-faint">
                          {project.reference}
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={PROJECT_STATUS_TONES[project.status] ?? 'neutral'}>
                        {humanise(project.status)}
                      </Badge>
                    </Td>
                    <Td>
                      <ProgressBar value={project.progress} showLabel />
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem]">
                      {formatMoney(project.value, project.currency)}
                    </Td>
                    <Td className="tabular font-mono text-xs">
                      {formatDate(project.deliveryDate)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="tasks">
        <Panel>
          {tasks.length === 0 ? (
            <EmptyState
              title="No tasks for this client"
              description="Work raised against their projects shows up here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] text-ink">{task.title}</span>
                    <span className="block font-mono text-[0.625rem] text-ink-faint">
                      {task.reference}
                    </span>
                  </span>
                  <Badge tone={TASK_STATUS_TONES[task.status] ?? 'neutral'}>
                    {humanise(task.status)}
                  </Badge>
                  <span className="w-28 shrink-0 truncate text-right text-[0.8125rem] text-ink-soft">
                    {task.assignee
                      ? `${task.assignee.firstName} ${task.assignee.lastName}`
                      : 'Unassigned'}
                  </span>
                  <span className="tabular w-24 shrink-0 text-right font-mono text-[0.6875rem] text-ink-faint">
                    {task.dueAt ? formatDate(task.dueAt) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="meetings">
        <Panel>
          <EmptyState
            title="Meetings arrive in phase 6"
            description="Calls and meetings, synced with Google Calendar, will show here."
          />
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="payments">
        <Panel>
          <EmptyState
            title="Payments arrive in phase 8"
            description="Invoiced, received and outstanding amounts will be tracked here."
          />
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="documents">
        <DocumentsPanel
          clientId={client.id}
          clientEmail={client.email}
          clientName={client.companyName}
        />
      </TabPanel>

      <TabPanel active={tab} tabKey="contacts">
        <Panel>
          {contacts.length === 0 ? (
            <EmptyState
              title="No contacts recorded"
              description="Add the people you deal with at this company."
            />
          ) : (
            <ul className="divide-y divide-line">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink">
                      {contact.firstName} {contact.lastName ?? ''}
                      {contact.isPrimary ? (
                        <Star aria-label="Primary contact" className="size-3.5 text-warning" />
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-ink-faint">
                      {[contact.designation, contact.email, contact.phone]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="activity">
        <Panel>
          {activity.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              description="Changes to this client are written here as they happen."
            />
          ) : (
            <ul className="divide-y divide-line">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <span className="text-[0.8125rem] text-ink-soft">
                    {entry.summary ?? humanise(entry.action)}
                    {entry.user ? (
                      <span className="ml-2 font-mono text-[0.625rem] text-ink-faint">
                        {entry.user.firstName} {entry.user.lastName}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular font-mono text-[0.6875rem] whitespace-nowrap text-ink-faint">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </TabPanel>

      <ClientFormModal open={editOpen} onClose={() => setEditOpen(false)} client={client} />
      {quoteOpen ? (
        <QuotationBuilder open onClose={() => setQuoteOpen(false)} fixedClientId={client.id} />
      ) : null}
      {projectOpen ? (
        <ProjectFormModal onClose={() => setProjectOpen(false)} fixedClientId={client.id} />
      ) : null}
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-panel px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p className="tabular mt-2 font-display text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[0.8125rem] text-ink-faint">{label}</span>
      <span className="text-right text-[0.8125rem] text-ink">{children}</span>
    </div>
  );
}
