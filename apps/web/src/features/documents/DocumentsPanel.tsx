import { useRef, useState } from 'react';
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
import { DocumentKind, PERMISSIONS, type EntityType } from '@probild/shared';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Badge, type Tone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthContext';
import { toMessage } from '@/lib/api';
import { cn, formatDateTime, humanise } from '@/lib/utils';
import { SendDocumentModal } from './SendDocumentModal';
import {
  downloadDocument,
  formatFileSize,
  useDeleteDocument,
  useDocuments,
  useMailStatus,
  useUploadDocument,
  type StoredDocument,
} from './api';

const KIND_TONES: Record<string, Tone> = {
  AGREEMENT: 'accent',
  QUOTATION: 'warning',
  INVOICE: 'success',
  PROPOSAL: 'accent',
  REPORT: 'neutral',
  OTHER: 'neutral',
};

/**
 * A client's paperwork: what has been sent, what was uploaded, and who received
 * what. Reusable from the client profile and from a project.
 */
export function DocumentsPanel({
  clientId,
  projectId,
  entityType,
  entityId,
  clientEmail,
  clientName,
}: {
  clientId?: string;
  projectId?: string;
  entityType?: EntityType;
  entityId?: string;
  clientEmail?: string | null;
  clientName?: string | null;
}) {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.DOCUMENT_WRITE);
  const canDelete = can(PERMISSIONS.DOCUMENT_DELETE);

  const documents = useDocuments({ clientId, projectId, entityType, entityId });
  const mail = useMailStatus();
  const uploadDocument = useUploadDocument();
  const deleteDocument = useDeleteDocument();

  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocumentKind>(DocumentKind.AGREEMENT);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState<StoredDocument | null>(null);
  const [deleting, setDeleting] = useState<StoredDocument | null>(null);

  const onUpload = async (): Promise<void> => {
    if (!pendingFile) return;
    try {
      await uploadDocument.mutateAsync({
        file: pendingFile,
        kind,
        description: description || undefined,
        clientId,
        projectId,
        entityType,
        entityId,
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
      <div className="rounded-panel border border-line bg-panel">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <p className="eyebrow mb-1">Paperwork</p>
            <h2 className="text-[0.9375rem] font-semibold text-ink">Documents</h2>
          </div>
          {canWrite ? (
            <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden className="size-4" />
              Upload
            </Button>
          ) : null}
        </header>

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
          <p className="border-b border-line px-5 py-2.5 text-xs text-ink-faint">
            Email is not set up, so documents can be downloaded but not sent from here.
          </p>
        ) : null}

        {documents.isPending || !documents.data ? (
          <LoadingState label="Loading documents" />
        ) : documents.isError ? (
          <ErrorState
            message={toMessage(documents.error)}
            onRetry={() => void documents.refetch()}
          />
        ) : documents.data.items.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden className="size-4.5" />}
            title="No documents yet"
            description="Upload an agreement, or generate a quotation or invoice and send it from here."
            action={
              canWrite ? (
                <Button size="sm" variant="primary" onClick={() => fileInput.current?.click()}>
                  <Upload aria-hidden className="size-4" />
                  Upload a document
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {documents.data.items.map((document) => {
              const lastSend = document.sends[0];
              const failed = lastSend?.status === 'FAILED';

              return (
                <li
                  key={document.id}
                  className={cn('px-5 py-3.5', failed && 'edge-marker text-danger')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
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
                        {formatFileSize(document.sizeBytes)} ·{' '}
                        {document.uploadedBy
                          ? `${document.uploadedBy.firstName} ${document.uploadedBy.lastName}`
                          : 'Probild'}{' '}
                        · {formatDateTime(document.createdAt)}
                        {document.description ? ` · ${document.description}` : ''}
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
                          {document.sends.length > 1 ? (
                            <span className="text-ink-faint">
                              · {document.sends.length} sends
                            </span>
                          ) : null}
                        </p>
                      ) : null}
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

                      {canWrite ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Send ${document.name}`}
                          onClick={() => setSending(document)}
                        >
                          <Send aria-hidden className="size-4" />
                        </Button>
                      ) : null}

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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
          <Field label="What is it?" htmlFor="documentKind">
            <Select
              id="documentKind"
              value={kind}
              onChange={(event) => setKind(event.target.value as DocumentKind)}
            >
              {Object.values(DocumentKind).map((entry) => (
                <option key={entry} value={entry}>
                  {humanise(entry)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="documentDescription" hint="Optional.">
            <Input
              id="documentDescription"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Signed master services agreement"
            />
          </Field>
        </div>
      </Modal>

      {sending ? (
        <SendDocumentModal
          key={sending.id}
          document={sending}
          defaultTo={clientEmail}
          defaultToName={clientName}
          companyName={clientName}
          onClose={() => setSending(null)}
        />
      ) : null}

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
