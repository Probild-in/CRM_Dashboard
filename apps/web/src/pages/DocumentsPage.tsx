import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCheck,
  Download,
  FileText,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { DocumentKind, PERMISSIONS } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Badge, type Tone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Table';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthContext';
import { useClients } from '@/features/clients/api';
import { SendSelectedModal } from '@/features/documents/SendSelectedModal';
import {
  downloadDocument,
  formatFileSize,
  useDeleteDocument,
  useDocuments,
  useMailStatus,
  useUploadDocument,
  type StoredDocument,
} from '@/features/documents/api';
import { toMessage } from '@/lib/api';
import { cn, formatDateTime, humanise, plural } from '@/lib/utils';

const KIND_TONES: Record<string, Tone> = {
  AGREEMENT: 'accent',
  QUOTATION: 'warning',
  INVOICE: 'success',
  PROPOSAL: 'accent',
  REPORT: 'neutral',
  OTHER: 'neutral',
};

/**
 * The document library.
 *
 * Pick a client, pick the papers, send them in one email. The client filter is
 * the point of the screen — sending is a per-client act, so a selection that
 * spans two clients is refused rather than quietly sent to one of them.
 */
export default function DocumentsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.DOCUMENT_WRITE);
  const canDelete = can(PERMISSIONS.DOCUMENT_DELETE);

  const [page, setPage] = useState(1);
  const [clientId, setClientId] = useState('');
  const [kind, setKind] = useState<DocumentKind | ''>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadKind, setUploadKind] = useState<DocumentKind>(DocumentKind.AGREEMENT);
  const [uploadClientId, setUploadClientId] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState<StoredDocument | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const clients = useClients({ page: 1, pageSize: 100 });
  const mail = useMailStatus();
  const uploadDocument = useUploadDocument();
  const deleteDocument = useDeleteDocument();

  const query = useDocuments({
    page,
    pageSize: 25,
    clientId: clientId || undefined,
    kind,
    search,
    requireScope: false,
  });

  // A new array identity every render would defeat the memo below.
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const client = clients.data?.items.find((entry) => entry.id === clientId);

  const selectedDocuments = useMemo(
    () => items.filter((document) => selected.has(document.id)),
    [items, selected],
  );

  /** Sending is per client, so a mixed selection has no single recipient. */
  const selectedClientIds = new Set(
    selectedDocuments.map((document) => document.client?.id ?? 'none'),
  );
  const mixedClients = selectedClientIds.size > 1;
  const selectionClientId =
    selectedDocuments[0]?.client?.id ?? (clientId || undefined);

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
    setSelected(new Set());
  };

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allShownSelected = items.length > 0 && items.every((entry) => selected.has(entry.id));

  const onUpload = async (): Promise<void> => {
    if (!pendingFile) return;
    if (!uploadClientId) {
      toast.error('Choose the client this belongs to.');
      return;
    }
    try {
      await uploadDocument.mutateAsync({
        file: pendingFile,
        kind: uploadKind,
        description: description || undefined,
        clientId: uploadClientId,
      });
      toast.success(`Added ${pendingFile.name}`);
      setPendingFile(null);
      setDescription('');
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Documents"
        description="Agreements, quotations and invoices. Pick a client, pick the papers, send them in one email."
        action={
          canWrite ? (
            <Button
              variant="secondary"
              onClick={() => {
                setUploadClientId(clientId);
                fileInput.current?.click();
              }}
            >
              <Upload aria-hidden className="size-4" />
              Upload
            </Button>
          ) : null
        }
      />

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label="Choose a document"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) setPendingFile(file);
          event.target.value = '';
        }}
      />

      {mail.data && !mail.data.configured ? (
        <p className="edge-marker mb-5 rounded-r bg-warning-soft py-2.5 pr-4 pl-4 text-[0.8125rem] text-warning">
          Email is not set up yet, so documents can be downloaded but not sent from here. An
          administrator adds the SMTP settings to the API.
        </p>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <Select
            value={clientId}
            onChange={(event) => change(setClientId)(event.target.value)}
            aria-label="Client"
            className="h-9 w-auto min-w-52"
          >
            <option value="">All clients</option>
            {clients.data?.items.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.companyName}
              </option>
            ))}
          </Select>

          <Select
            value={kind}
            onChange={(event) => change(setKind)(event.target.value as DocumentKind | '')}
            aria-label="Document type"
            className="h-9 w-auto"
          >
            <option value="">Every type</option>
            {Object.values(DocumentKind).map((entry) => (
              <option key={entry} value={entry}>
                {humanise(entry)}
              </option>
            ))}
          </Select>

          <Input
            type="search"
            value={search}
            onChange={(event) => change(setSearch)(event.target.value)}
            placeholder="Search by name"
            aria-label="Search documents"
            className="h-9 max-w-xs"
          />

          {items.length > 0 ? (
            <label className="ml-auto flex items-center gap-2 text-[0.8125rem] text-ink-soft">
              <input
                type="checkbox"
                checked={allShownSelected}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? new Set(items.map((entry) => entry.id)) : new Set(),
                  )
                }
                className="size-4 accent-[var(--app-accent)]"
              />
              Select all shown
            </label>
          ) : null}
        </div>

        {/* The action bar appears only once something is selected. */}
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-soft px-5 py-3">
            <p className="text-[0.8125rem] font-medium text-accent">
              {plural(selected.size, 'document')} selected
            </p>

            {mixedClients ? (
              <p className="text-[0.8125rem] text-danger">
                These belong to different clients. Send one client's papers at a time.
              </p>
            ) : null}

            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  for (const document of selectedDocuments) {
                    try {
                      await downloadDocument(document);
                    } catch (error) {
                      toast.error(toMessage(error));
                    }
                  }
                }}
              >
                <Download aria-hidden className="size-4" />
                Download
              </Button>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={mixedClients}
                  onClick={() => setSending(true)}
                >
                  <Send aria-hidden className="size-4" />
                  Send to client
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {query.isPending ? (
          <TableSkeleton rows={8} columns={4} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden className="size-4.5" />}
            title={
              clientId || kind || search ? 'Nothing matches those filters' : 'No documents yet'
            }
            description={
              clientId || kind || search
                ? 'Clear the filters to see everything on file.'
                : 'Upload an agreement, or generate a quotation or invoice and it lands here.'
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {items.map((document) => {
                const lastSend = document.sends[0];
                const failed = lastSend?.status === 'FAILED';
                const isSelected = selected.has(document.id);

                return (
                  <li
                    key={document.id}
                    className={cn(
                      'flex items-start gap-3 px-5 py-3.5 transition-colors',
                      isSelected && 'bg-accent-soft/40',
                      failed && 'edge-marker text-danger',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(document.id)}
                      aria-label={`Select ${document.name}`}
                      className="mt-1 size-4 shrink-0 accent-[var(--app-accent)]"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[0.8125rem] font-medium text-ink">
                          {document.name}
                        </span>
                        <Badge tone={KIND_TONES[document.kind] ?? 'neutral'}>
                          {humanise(document.kind)}
                        </Badge>
                        {document.isGenerated ? (
                          <Badge>
                            <Sparkles aria-hidden className="mr-1 inline size-3" />
                            Generated
                          </Badge>
                        ) : null}
                      </p>

                      <p className="mt-0.5 truncate text-xs text-ink-faint">
                        {document.client ? (
                          <Link
                            to={`/clients/${document.client.id}`}
                            className="hover:text-accent"
                          >
                            {document.client.companyName}
                          </Link>
                        ) : (
                          'No client'
                        )}{' '}
                        · {formatFileSize(document.sizeBytes)} · {formatDateTime(document.createdAt)}
                      </p>

                      {lastSend ? (
                        <p
                          className={cn(
                            'mt-1.5 flex items-center gap-1.5 text-xs',
                            failed ? 'text-danger' : 'text-success',
                          )}
                        >
                          {failed ? (
                            <TriangleAlert aria-hidden className="size-3.5" />
                          ) : (
                            <CheckCheck aria-hidden className="size-3.5" />
                          )}
                          {failed
                            ? `Could not reach ${lastSend.recipientEmail} — ${lastSend.error ?? 'the message bounced'}`
                            : `Sent to ${lastSend.recipientEmail} on ${formatDateTime(lastSend.sentAt)}`}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs text-ink-faint">Not sent yet</p>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Download ${document.name}`}
                        onClick={async () => {
                          try {
                            await downloadDocument(document);
                          } catch (error) {
                            toast.error(toMessage(error));
                          }
                        }}
                      >
                        <Download aria-hidden className="size-4" />
                      </Button>
                      {canDelete ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${document.name}`}
                          onClick={() => setDeleting(document)}
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {query.data ? (
              <Pagination meta={query.data.meta} onPageChange={setPage} label="documents" />
            ) : null}
          </>
        )}
      </Panel>

      {sending && selectedDocuments.length > 0 ? (
        <SendSelectedModal
          documents={selectedDocuments}
          clientId={selectionClientId}
          clientName={selectedDocuments[0]?.client?.companyName ?? client?.companyName ?? null}
          clientEmail={client?.email ?? null}
          onClose={() => setSending(false)}
          onSent={() => setSelected(new Set())}
        />
      ) : null}

      <Modal
        open={Boolean(pendingFile)}
        onClose={() => setPendingFile(null)}
        size="sm"
        title="Add this document"
        description={pendingFile ? `${pendingFile.name} · ${formatFileSize(pendingFile.size)}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingFile(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={uploadDocument.isPending}
              onClick={() => void onUpload()}
            >
              Add it
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Which client?" htmlFor="uploadClient" required>
            <Select
              id="uploadClient"
              value={uploadClientId}
              onChange={(event) => setUploadClientId(event.target.value)}
            >
              <option value="">Choose a client</option>
              {clients.data?.items.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.companyName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What is it?" htmlFor="uploadKind">
            <Select
              id="uploadKind"
              value={uploadKind}
              onChange={(event) => setUploadKind(event.target.value as DocumentKind)}
            >
              {Object.values(DocumentKind).map((entry) => (
                <option key={entry} value={entry}>
                  {humanise(entry)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="uploadDescription" hint="Optional.">
            <Input
              id="uploadDescription"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Signed master services agreement"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        loading={deleteDocument.isPending}
        destructive
        title="Delete this document?"
        confirmLabel="Delete"
        message={
          deleting
            ? `"${deleting.name}" will be removed along with its file. Its send history goes with it.`
            : ''
        }
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteDocument.mutateAsync(deleting.id);
            toast.success('Document deleted');
            setDeleting(null);
          } catch (error) {
            toast.error(toMessage(error));
          }
        }}
      />
    </>
  );
}
